/**
 * STUDENT IMPORT SERVICE
 * ======================
 *
 * SchoolPay-driven student import.
 *
 * Parses SchoolPay export files (CSV or Excel via SheetJS, dynamically imported
 * so it stays out of the main bundle), validates rows, reconciles with existing
 * students, and commits idempotent upserts via Firestore batched writes.
 *
 * Design decisions (approved):
 *   A. Existing student doc IDs are never changed. New imported students get
 *      doc ID = schoolpayCode. Matching is via an in-memory Map keyed by
 *      schoolpayCode built from getStudents().
 *   B. First-import reconciliation: code-less existing students can be linked
 *      by admission number, or by normalised full name + class.
 *   C. Field ownership: SchoolPay-owned (overwritten): schoolpayCode,
 *      fullName, classLevel. School-owned (never touched): stream, guardian
 *      fields, notes, photo, curriculum, marks and all report data.
 *   D. source:'schoolpay' for imported students, source:'manual' for manual
 *      students. Manual students are never inactivated.
 *   E. Class changes: appended to classHistory, stream cleared, flagged as
 *      needing a stream.
 *   F. Inactivation: status:'inactive' (never delete) for students with a
 *      schoolpayCode absent from the import. Requires fullList safeguard.
 *   G. Batched writes: writeBatch chunks of <= 500, set(..., {merge: true}).
 *      Codes read as text: trimmed, leading zeros preserved, scientific
 *      notation guarded.
 */

import { getAllDocs, safeGet } from './firebase.js';
import { getConfig } from './configService.js';
import { doc, writeBatch, setDoc } from 'firebase/firestore';
import { db } from './firebase.js';
import { CLASSES } from '../utils/constants.js';

const COL = 'students';
const BATCH_SIZE = 500;

// ── SheetJS (vendored at src/lib/xlsx.mjs, dynamic import to stay out of bundle) ──
let XLSX = null;
async function getXLSX() {
  if (!XLSX) {
    const mod = await import('../lib/xlsx.mjs');
    XLSX = mod.XLSX;
  }
  return XLSX;
}

// ── Read a cell as text: preserve leading zeros, guard scientific notation ──
function cellToText(cell) {
  if (cell == null || cell === '') return '';
  if (typeof cell === 'number') {
    if (Number.isInteger(cell)) return String(cell);
    const s = String(cell);
    if (/e/i.test(s)) return String(Math.floor(cell));
    return s;
  }
  return String(cell).trim();
}

/**
 * Normalise a SchoolPay code: trim, preserve leading zeros, guard against
 * Excel scientific notation (e.g. 1.23E+11 -> 123000000000).
 */
export function normalizeCode(value) {
  const trimmed = cellToText(value);
  if (!trimmed) return '';

  // Guard against Excel scientific notation (e.g. "1.23E+11" -> "123000000000").
  // Only convert when the string matches a scientific-notation pattern; leading
  // zeros (e.g. "00123") and non-numeric codes are returned as-is.
  const sciMatch = trimmed.match(/^(\d+(?:\.\d+)?)[eE]([-+]?\d+)$/);
  if (sciMatch) {
    const num = Number(trimmed);
    return String(Math.floor(num));
  }

  return trimmed;
}

// ── Parse a CSV or Excel file into {headers, rows} ──
// `deps.XLSX` allows injecting a mock SheetJS implementation for unit testing.
export async function parseFile(file, deps = {}) {
  const { XLSX: injectedXLSX } = deps;
  const XLSX = injectedXLSX || await getXLSX();
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, {type: 'array'});
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  // raw: true gives raw cell values (numbers as numbers); we normalise codes ourselves
  const data = XLSX.utils.sheet_to_json(worksheet, {header: 1, raw: true});
  if (!data || data.length < 2) return {headers: [], rows: []};

  const headers = data[0].map((h) => String(h || '').trim());
  const rows = data.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = cellToText(row[i]);
    });
    return obj;
  });
  return {headers, rows};
}

// ── Build a Map of existing students keyed by schoolpayCode ──
export async function buildCodeMap(students) {
  const map = new Map();
  for (const s of students) {
    const code = normalizeCode(s.schoolpayCode);
    if (code) map.set(code, s);
  }
  return map;
}

// ── Validate rows: missing code, duplicate code within file, unknown class ──
export function validateRows(rows, codeMap, validClasses = CLASSES) {
  const ready = [];
  const problems = [];
  const seenCodes = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const code = normalizeCode(row.schoolpayCode);
    const classLevel = (row.classLevel || '').trim();

    let reason = null;
    if (!code) {
      reason = 'Missing SchoolPay code';
    } else if (seenCodes.has(code)) {
      reason = `Duplicate SchoolPay code "${code}" in file`;
    } else if (!validClasses.includes(classLevel)) {
      reason = `Class "${classLevel}" not in system`;
    } else {
      seenCodes.add(code);
    }

    if (reason) {
      problems.push({rowIndex: i, row, code, classLevel, reason});
    } else {
      ready.push({
        rowIndex: i,
        row,
        code,
        classLevel,
        fullName: (row.fullName || '').trim(),
      });
    }
  }

  return {ready, problems};
}

// ── Reconcile: match code-less existing students by admission number, then name + class ──
export function matchExisting(readyRows, students) {
  // Index code-less students by admission number
  const byAdmissionNo = new Map();
  for (const s of students) {
    if (!s.schoolpayCode && s.admissionNumber) {
      byAdmissionNo.set(s.admissionNumber.trim().toLowerCase(), s);
    }
  }

  // Index code-less students by normalised name + class
  const byNameClass = new Map();
  for (const s of students) {
    if (!s.schoolpayCode) {
      const key = `${(s.fullName || '').trim().toLowerCase()}|${(s.classLevel || '').trim()}`;
      if (!byNameClass.has(key)) byNameClass.set(key, []);
      byNameClass.get(key).push(s);
    }
  }

  for (const item of readyRows) {
    // Skip rows already matched to an existing code
    if (item.action) continue;

    // Try admission number match
    const admNo = (item.row.admissionNumber || '').trim();
    if (admNo && byAdmissionNo.has(admNo.toLowerCase())) {
      item.action = 'link';
      item.existingStudent = byAdmissionNo.get(admNo.toLowerCase());
      item.matchMethod = 'admissionNumber';
      continue;
    }

    // Try name + class match (only unambiguous)
    const nameKey = `${item.fullName.toLowerCase()}|${item.classLevel}`;
    const matches = byNameClass.get(nameKey);
    if (matches && matches.length === 1) {
      item.action = 'link';
      item.existingStudent = matches[0];
      item.matchMethod = 'nameAndClass';
      continue;
    }

    // No match → brand new student
    item.action = 'new';
  }

  return readyRows;
}

// ── Classify rows into categories with counts ──
export function classifyRows(readyRows, codeMap) {
  const categories = {
    new: [],
    link: [],
    update: [],
    classChanged: [],
    unchanged: [],
  };

  for (const item of readyRows) {
    // Already linked to a code-less student (admission no / name match)
    if (item.action === 'link') {
      categories.link.push(item);
      continue;
    }

    const existing = codeMap.get(item.code);
    if (!existing) {
      // No existing student with this code → brand new
      categories.new.push(item);
      continue;
    }

    const nameChanged = (existing.fullName || '').trim() !== item.fullName;
    const classChanged = (existing.classLevel || '') !== item.classLevel;

    if (classChanged) {
      item.action = 'classChanged';
      item.existingStudent = existing;
      categories.classChanged.push(item);
    } else if (nameChanged) {
      item.action = 'update';
      item.existingStudent = existing;
      categories.update.push(item);
    } else {
      categories.unchanged.push(item);
    }
  }

  const counts = {
    new: categories.new.length,
    link: categories.link.length,
    update: categories.update.length,
    classChanged: categories.classChanged.length,
    unchanged: categories.unchanged.length,
    total: readyRows.length,
  };

  return {categories, counts};
}

// ── Find coded students absent from the import (inactivation candidates) ──
export function findStudentsToInactivate(allStudents, importedCodes) {
  return allStudents.filter((s) => {
    const code = normalizeCode(s.schoolpayCode);
    return code && !importedCodes.has(code) && s.source === 'schoolpay';
  });
}

// ── Chunk an array into max-size chunks ──
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// ── Commit accepted rows via batched merge writes (chunks of <= 500) ──
// `deps` allows injecting mock Firebase implementations for testing.
export async function commitImport(acceptedRows, options = {}, deps = {}) {
  const {fullList = false, studentsToInactivate = []} = options;
  const {
    writeBatch: writeBatchImpl = writeBatch,
    doc: docImpl = doc,
    db: dbInstance = db,
    getConfig: getConfigImpl = getConfig,
  } = deps;

  const config = await getConfigImpl();
  const academicYear = config?.academicYear || '';
  const currentTerm = config?.currentTerm || '';
  const now = new Date().toISOString();

  const writeOps = []; // {ref, data}

  for (const item of acceptedRows) {
    if (item.action === 'unchanged') continue;

    if (item.action === 'new') {
      const ref = docImpl(dbInstance, COL, item.code);
      writeOps.push({
        ref,
        data: {
          type: 'student',
          schoolpayCode: item.code,
          source: 'schoolpay',
          admissionNumber: item.row.admissionNumber || '',
          fullName: item.fullName,
          dateOfBirth: '',
          gender: '',
          classLevel: item.classLevel,
          stream: '', // school-owned; import never sets it
          classStream: item.classLevel,
          guardianName: '',
          guardianPhone: '',
          guardianRelationship: '',
          status: 'active',
          enrollmentDate: now.split('T')[0],
          notes: '',
          curriculum: '',
          referenceId: '',
          createdAt: now,
          updatedAt: now,
        },
      });
    } else if (item.action === 'link') {
      // Set schoolpayCode on the existing doc (link it to SchoolPay)
      const ref = docImpl(dbInstance, COL, item.existingStudent.id);
      writeOps.push({
        ref,
        data: {
          schoolpayCode: item.code,
          source: 'schoolpay',
          updatedAt: now,
        },
      });
    } else if (item.action === 'update') {
      // Overwrite SchoolPay-owned fields only
      const existing = item.existingStudent;
      const ref = docImpl(dbInstance, COL, existing.id);
      writeOps.push({
        ref,
        data: {
          fullName: item.fullName,
          classLevel: item.classLevel,
          classStream: `${item.classLevel}${existing.stream || ''}`.replace(/undefined$/, '') || item.classLevel,
          updatedAt: now,
        },
      });
    } else if (item.action === 'classChanged') {
      const existing = item.existingStudent;
      const classHistory = [
        ...(existing.classHistory || []),
        {academicYear, term: currentTerm, classLevel: item.classLevel, changedAt: now},
      ];
      const stream = existing.stream || '';
      const ref = docImpl(dbInstance, COL, existing.id);
      writeOps.push({
        ref,
        data: {
          classLevel: item.classLevel,
          stream: '', // cleared — flagged as needing a stream
          classStream: `${item.classLevel}${stream}`.replace(/undefined$/, '') || item.classLevel,
          classHistory,
          needsStream: true,
          updatedAt: now,
        },
      });
    }
  }

  // ── Inactivation: only when the full-list safeguard is checked ──
  if (fullList && studentsToInactivate.length > 0) {
    for (const s of studentsToInactivate) {
      const ref = docImpl(dbInstance, COL, s.id);
      writeOps.push({
        ref,
        data: {
          status: 'inactive',
          updatedAt: now,
        },
      });
    }
  }

  // Write in chunks of BATCH_SIZE, each with merge: true
  const chunks = chunkArray(writeOps, BATCH_SIZE);
  let written = 0;
  for (const opsChunk of chunks) {
    const batch = writeBatchImpl(dbInstance);
    for (const {ref, data} of opsChunk) {
      batch.set(ref, data, {merge: true});
      written++;
    }
    await batch.commit();
  }

  const inactivated = fullList ? studentsToInactivate.length : 0;

  return {written, inactivated};
}

export {BATCH_SIZE};
