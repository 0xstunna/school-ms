/**
 * Student import service unit tests
 * =================================
 *
 * Covers: missing-code flag, duplicate-code flag, unknown-class flag,
 * leading-zero / scientific-notation codes, unchanged detection,
 * link-to-existing matching, class-change handling (history appended,
 * stream cleared), merge preserving stream/guardian fields,
 * batch chunking <= 500, inactivation only for students with a code,
 * the full-list safeguard, reactivation of returning students.
 *
 * Run with: node src/services/__tests__/studentImport.test.js
 */

import assert from 'node:assert/strict';

import {
  normalizeCode,
  validateRows,
  matchExisting,
  classifyRows,
  findStudentsToInactivate,
  commitImport,
  parseFile,
} from '../../db/studentImportService.js';

import fs from 'fs';

// ── Helpers ──
let counter = 0;
function student(code, overrides = {}) {
  counter++;
  return {
    id: `student_${code || 'manual'}_${counter}`,
    schoolpayCode: code || '',
    source: code ? 'schoolpay' : 'manual',
    fullName: 'Student',
    classLevel: 'S1',
    stream: 'A',
    classStream: 'S1A',
    guardianName: 'Guardian',
    guardianPhone: '+256700000000',
    ...overrides,
  };
}

function row(code, overrides = {}) {
  return {
    schoolpayCode: code,
    fullName: 'Student',
    classLevel: 'S1',
    admissionNumber: '',
    ...overrides,
  };
}

const validClasses = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];

// ── normalizeCode ──
console.log('--- normalizeCode ---');

assert.strictEqual(normalizeCode('00123'), '00123', 'leading zeros preserved');
assert.strictEqual(normalizeCode('  ABC  '), 'ABC', 'trimmed');
assert.strictEqual(normalizeCode(''), '', 'empty string');
assert.strictEqual(normalizeCode(null), '', 'null');
assert.strictEqual(normalizeCode(undefined), '', 'undefined');
assert.strictEqual(normalizeCode('1.23E+11'), '123000000000', 'scientific notation guarded');
assert.strictEqual(normalizeCode('1.5E+2'), '150', 'scientific notation small');
assert.strictEqual(normalizeCode(12345), '12345', 'number input');
console.log('  normalizeCode: PASS');

// ── validateRows ──
console.log('--- validateRows ---');

const codeMap = new Map();
codeMap.set('SP001', student('SP001'));

// missing code
let {ready, problems} = validateRows([row(undefined)], codeMap, validClasses);
assert.strictEqual(problems.length, 1, 'missing code flagged');
assert.strictEqual(problems[0].reason, 'Missing SchoolPay code');
assert.strictEqual(ready.length, 0, 'no ready rows for missing code');

// duplicate code within file
({ready, problems} = validateRows([row('SP001'), row('SP001')], codeMap, validClasses));
assert.strictEqual(problems.length, 1, 'duplicate code flagged');
assert.ok(problems[0].reason.includes('Duplicate'), 'duplicate reason mentions duplicate');
assert.strictEqual(ready.length, 1, 'first duplicate is ready');

// unknown class
({ready, problems} = validateRows([row('SP002', {classLevel: 'S9'})], codeMap, validClasses));
assert.strictEqual(problems.length, 1, 'unknown class flagged');
assert.ok(problems[0].reason.includes('not in system'), 'unknown class reason');

// valid row
({ready, problems} = validateRows([row('SP002')], codeMap, validClasses));
assert.strictEqual(problems.length, 0, 'valid row has no problems');
assert.strictEqual(ready.length, 1, 'valid row is ready');
assert.strictEqual(ready[0].code, 'SP002');
console.log('  validateRows: PASS');

// ── matchExisting ──
console.log('--- matchExisting ---');

const students = [
  student('SP001', {id: 's1', fullName: 'Alice', classLevel: 'S1'}),
  student('', {id: 's2', fullName: 'Bob', admissionNumber: 'ADM001', classLevel: 'S1', schoolpayCode: '', source: 'manual'}),
  student('', {id: 's3', fullName: 'Carol', admissionNumber: '', classLevel: 'S2', schoolpayCode: '', source: 'manual'}),
  student('', {id: 's4', fullName: 'Carol', admissionNumber: '', classLevel: 'S2', schoolpayCode: '', source: 'manual'}), // ambiguous name+class
];

const readyRows = [
  {rowIndex: 0, row: {schoolpayCode: 'SP002', fullName: 'Alice', admissionNumber: '', classLevel: 'S1'}, code: 'SP002', classLevel: 'S1', fullName: 'Alice', action: undefined},
  {rowIndex: 1, row: {schoolpayCode: 'SP003', fullName: 'Bob', admissionNumber: 'ADM001', classLevel: 'S1'}, code: 'SP003', classLevel: 'S1', fullName: 'Bob', action: undefined},
  {rowIndex: 2, row: {schoolpayCode: 'SP004', fullName: 'Carol', admissionNumber: '', classLevel: 'S2'}, code: 'SP004', classLevel: 'S2', fullName: 'Carol', action: undefined},
  {rowIndex: 3, row: {schoolpayCode: 'SP005', fullName: 'Dan', admissionNumber: '', classLevel: 'S3'}, code: 'SP005', classLevel: 'S3', fullName: 'Dan', action: undefined},
];

matchExisting(readyRows, students);

assert.strictEqual(readyRows[0].action, 'new', 'no match -> new');
assert.strictEqual(readyRows[1].action, 'link', 'admission number match -> link');
assert.strictEqual(readyRows[1].matchMethod, 'admissionNumber', 'matched by admission number');
assert.strictEqual(readyRows[1].existingStudent.id, 's2', 'linked to Bob');
assert.strictEqual(readyRows[2].action, 'new', 'ambiguous name+class -> new (not auto-linked)');
assert.strictEqual(readyRows[3].action, 'new', 'no match -> new');
console.log('  matchExisting: PASS');

// ── classifyRows ──
console.log('--- classifyRows ---');

const codeMap2 = new Map();
codeMap2.set('SP001', student('SP001', {id: 's1', fullName: 'Alice', classLevel: 'S1'}));
codeMap2.set('SP002', student('SP002', {id: 's2', fullName: 'Bob', classLevel: 'S1'}));

const classified = [
  {action: 'new', row: {}, code: 'SP003', fullName: 'New', classLevel: 'S1'},
  {action: 'link', row: {}, code: 'SP004', fullName: 'Linked', classLevel: 'S1', existingStudent: student('', {id: 's3'})},
  {action: 'update', row: {}, code: 'SP002', fullName: 'Bob Updated', classLevel: 'S1', existingStudent: student('SP002', {id: 's2', fullName: 'Bob', classLevel: 'S1'})},
  {action: 'classChanged', row: {}, code: 'SP001', fullName: 'Alice', classLevel: 'S2', existingStudent: student('SP001', {id: 's1', fullName: 'Alice', classLevel: 'S1', stream: 'A'})},
  {action: 'unchanged', row: {}, code: 'SP002', fullName: 'Bob', classLevel: 'S1', existingStudent: student('SP002', {id: 's2', fullName: 'Bob', classLevel: 'S1'})},
];

const {categories, counts} = classifyRows(classified, codeMap2);
assert.strictEqual(counts.new, 1, '1 new');
assert.strictEqual(counts.link, 1, '1 link');
assert.strictEqual(counts.update, 1, '1 update');
assert.strictEqual(counts.classChanged, 1, '1 class changed');
assert.strictEqual(counts.unchanged, 1, '1 unchanged');
assert.strictEqual(counts.total, 5, '5 total');
console.log('  classifyRows: PASS');

// ── findStudentsToInactivate ──
console.log('--- findStudentsToInactivate ---');

const allStudents = [
  student('SP001', {id: 's1', source: 'schoolpay'}), // in import -> not inactivated
  student('SP002', {id: 's2', source: 'schoolpay'}), // NOT in import -> inactivated
  student('', {id: 's3', source: 'manual'}), // manual -> never inactivated
];

const importedCodes = new Set(['SP001']);
const toInactivate = findStudentsToInactivate(allStudents, importedCodes);
assert.strictEqual(toInactivate.length, 1, 'only coded students absent from import');
assert.strictEqual(toInactivate[0].id, 's2', 'SP002 is the one to inactivate');
console.log('  findStudentsToInactivate: PASS');

// ── commitImport ──
console.log('--- commitImport ---');

let batchCommits = 0;
let batchSetCalls = 0;
let lastMerge = null;
let lastSetData = null;
let lastSetRef = null;

const mockBatch = {
  set: (ref, data, opts) => {
    batchSetCalls++;
    lastMerge = opts && opts.merge;
    lastSetData = data;
    lastSetRef = ref;
    return mockBatch;
  },
  commit: async () => { batchCommits++; },
};

const mockWriteBatch = (dbInstance) => mockBatch;
const mockDoc = (dbInstance, col, id) => ({id, col, path: `${col}/${id}`});
const mockGetConfig = async () => ({academicYear: '2026/2027', currentTerm: 'Term 1'});

// Test: new + update (2 ops, 1 batch, merge: true)
const accepted1 = [
  {action: 'new', code: 'NEW01', row: {admissionNumber: 'ADM01'}, fullName: 'New One', classLevel: 'S1'},
  {action: 'update', code: 'SP002', fullName: 'Bob Updated', classLevel: 'S1', existingStudent: student('SP002', {id: 's2', fullName: 'Bob', stream: 'A', guardianName: 'Guardian Bob'})},
];

batchCommits = 0;
batchSetCalls = 0;
await commitImport(accepted1, {}, {
  writeBatch: mockWriteBatch,
  doc: mockDoc,
  db: 'mock-db',
  getConfig: mockGetConfig,
});

assert.strictEqual(batchCommits, 1, '2 ops -> 1 batch');
assert.strictEqual(batchSetCalls, 2, '2 set calls');
assert.strictEqual(lastMerge, true, 'merge: true');

// Verify update only writes SchoolPay-owned fields (stream/guardian NOT in payload)
assert.ok(lastSetData.fullName === 'Bob Updated', 'fullName overwritten');
assert.ok(lastSetData.classLevel === 'S1', 'classLevel overwritten');
assert.ok(!('stream' in lastSetData), 'stream NOT in update payload (preserved by merge)');
assert.ok(!('guardianName' in lastSetData), 'guardianName NOT in update payload (preserved by merge)');
console.log('  commitImport (new+update, merge preserves school-owned fields): PASS');

// Test: classChanged appends history and clears stream
batchCommits = 0;
batchSetCalls = 0;
const existingWithHistory = student('SP001', {
  id: 's1', fullName: 'Alice', classLevel: 'S1', stream: 'A',
  classHistory: [{academicYear: '2025/2026', term: 'Term 1', classLevel: 'S1'}],
});
await commitImport([{action: 'classChanged', code: 'SP001', fullName: 'Alice', classLevel: 'S2', existingStudent: existingWithHistory}], {}, {
  writeBatch: mockWriteBatch,
  doc: mockDoc,
  db: 'mock-db',
  getConfig: mockGetConfig,
});

assert.strictEqual(batchCommits, 1, '1 classChanged op -> 1 batch');
assert.strictEqual(batchSetCalls, 1, '1 set call');
assert.ok(lastSetData.stream === '', 'stream cleared on class change');
assert.ok(Array.isArray(lastSetData.classHistory), 'classHistory is an array');
assert.strictEqual(lastSetData.classHistory.length, 2, 'classHistory appended (1 old + 1 new)');
assert.strictEqual(lastSetData.classHistory[1].classLevel, 'S2', 'new class change recorded');
assert.strictEqual(lastSetData.needsStream, true, 'needsStream flag set');
console.log('  commitImport (classChanged: history appended, stream cleared): PASS');

// Test: inactivation requires fullList safeguard
batchCommits = 0;
batchSetCalls = 0;
const codedStudents = [student('SP001', {id: 's1', source: 'schoolpay'}), student('SP002', {id: 's2', source: 'schoolpay'})];

await commitImport([], {fullList: false, studentsToInactivate: codedStudents}, {
  writeBatch: mockWriteBatch,
  doc: mockDoc,
  db: 'mock-db',
  getConfig: mockGetConfig,
});
assert.strictEqual(batchCommits, 0, 'no inactivation without fullList');

await commitImport([], {fullList: true, studentsToInactivate: codedStudents}, {
  writeBatch: mockWriteBatch,
  doc: mockDoc,
  db: 'mock-db',
  getConfig: mockGetConfig,
});
assert.strictEqual(batchCommits, 1, 'inactivation with fullList -> 1 batch');
assert.strictEqual(batchSetCalls, 2, '2 inactivation writes');
assert.strictEqual(lastSetData.status, 'inactive', 'inactivation sets status');
console.log('  commitImport (inactivation requires fullList): PASS');

// Test: reactivation - students in import are NOT inactivated (covered by findStudentsToInactivate)
// Verify a returning coded student is excluded from inactivation list
const returningStudents = [student('SP001', {id: 's1', source: 'schoolpay', status: 'inactive'})];
const returningCodes = new Set(['SP001']);
const toInactivate2 = findStudentsToInactivate(returningStudents, returningCodes);
assert.strictEqual(toInactivate2.length, 0, 'returning student not inactivated (reactivation path)');
console.log('  commitImport (reactivation: returning coded student not inactivated): PASS');

// Test: batch chunking <= 500 (1200 ops -> 3 batches: 500+500+200)
batchCommits = 0;
batchSetCalls = 0;
const manyOps = [];
for (let i = 0; i < 1200; i++) {
  manyOps.push({action: 'new', code: `C${i}`, row: {}, fullName: `Student ${i}`, classLevel: 'S1'});
}
await commitImport(manyOps, {}, {
  writeBatch: mockWriteBatch,
  doc: mockDoc,
  db: 'mock-db',
  getConfig: mockGetConfig,
});

assert.strictEqual(batchCommits, 3, '1200 ops -> 3 batches (<=500 each)');
assert.strictEqual(batchSetCalls, 1200, '1200 total set calls');
console.log('  commitImport (chunking <= 500): PASS');

// Test: unchanged rows are skipped (no write)
batchCommits = 0;
batchSetCalls = 0;
await commitImport([{action: 'unchanged', code: 'SP002', fullName: 'Bob', classLevel: 'S1', existingStudent: student('SP002')}], {}, {
  writeBatch: mockWriteBatch,
  doc: mockDoc,
  db: 'mock-db',
  getConfig: mockGetConfig,
});
assert.strictEqual(batchCommits, 0, 'unchanged rows skipped');
assert.strictEqual(batchSetCalls, 0, 'no writes for unchanged');
console.log('  commitImport (unchanged skipped): PASS');

// Test: link action writes schoolpayCode to existing doc
batchCommits = 0;
batchSetCalls = 0;
await commitImport([{action: 'link', code: 'SP003', fullName: 'Bob', classLevel: 'S1', existingStudent: student('', {id: 's2', source: 'manual'})}], {}, {
  writeBatch: mockWriteBatch,
  doc: mockDoc,
  db: 'mock-db',
  getConfig: mockGetConfig,
});

assert.strictEqual(batchSetCalls, 1, '1 set call for link');
assert.strictEqual(lastSetData.schoolpayCode, 'SP003', 'link sets schoolpayCode');
assert.strictEqual(lastSetData.source, 'schoolpay', 'link sets source');
console.log('  commitImport (link: sets schoolpayCode on existing doc): PASS');

// ── parseFile ── (requires a SheetJS-like implementation; injected via deps)
console.log('--- parseFile ---');

const mockXLSX = (data) => ({
  read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
  utils: { sheet_to_json: () => data },
});

// CSV with leading-zero codes: codes must survive as strings (not numbers)
const csvRows = [
  ['SchoolPay Code', 'Full Name', 'Class Level', 'Admission Number'],
  ['00123', 'Alice Mwangi', 'S1', 'ADM001'],
  ['SP002', 'Bob Okello', 'S2', 'ADM002'],
];
const csvFile = new File([JSON.stringify(csvRows)], 'students.csv', {
  type: 'text/csv',
});
const { headers, rows: parsed } = await parseFile(csvFile, {
  XLSX: mockXLSX(csvRows),
});
assert.strictEqual(headers[0], 'SchoolPay Code', 'header row detected');
assert.strictEqual(parsed.length, 2, 'two data rows parsed');
assert.strictEqual(parsed[0]['SchoolPay Code'], '00123', 'leading-zero code preserved as string');
assert.strictEqual(parsed[0]['Full Name'], 'Alice Mwangi', 'full name parsed');
assert.strictEqual(parsed[1]['SchoolPay Code'], 'SP002', 'regular code parsed');
console.log('  parseFile (CSV with leading-zero codes): PASS');

// Empty file: no header row → empty result (UI converts to a visible error)
const emptyFile = new File([], 'empty.csv', { type: 'text/csv' });
const { headers: eHeaders, rows: eRows } = await parseFile(emptyFile, {
  XLSX: mockXLSX([]),
});
assert.strictEqual(eHeaders.length, 0, 'empty file yields no headers');
assert.strictEqual(eRows.length, 0, 'empty file yields no rows');
console.log('  parseFile (empty file): PASS');

// Header-only sheet (data.length < 2) → empty result
const headerOnly = [['SchoolPay Code', 'Full Name']];
const headerOnlyFile = new File([JSON.stringify(headerOnly)], 'header.csv', {
  type: 'text/csv',
});
const { headers: hHeaders, rows: hRows } = await parseFile(headerOnlyFile, {
  XLSX: mockXLSX(headerOnly),
});
assert.strictEqual(hHeaders.length, 0, 'header-only sheet yields no headers');
assert.strictEqual(hRows.length, 0, 'header-only sheet yields no rows');
console.log('  parseFile (header-only sheet): PASS');

// Numeric cell in .xlsx: Excel may store codes as numbers. cellToText converts
// numbers to strings without crashing. Leading zeros already lost by Excel
// (when it stores the cell as a number) cannot be recovered — that is an Excel
// limitation, not a code bug. Codes stored as text ("00123") preserve leading zeros.
const numericRows = [
  ['SchoolPay Code', 'Full Name', 'Class Level', 'Admission Number'],
  [123, 'Alice Mwangi', 'S1', 'ADM001'],
  ['SP002', 'Bob Okello', 'S2', 'ADM002'],
];
const numericFile = new File([JSON.stringify(numericRows)], 'numeric.xlsx', {
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});
const { rows: numParsed } = await parseFile(numericFile, {
  XLSX: mockXLSX(numericRows),
});
assert.strictEqual(numParsed[0]['SchoolPay Code'], '123', 'numeric cell converted to string');
assert.strictEqual(numParsed[1]['SchoolPay Code'], 'SP002', 'string cell preserved');
console.log('  parseFile (numeric cell): PASS');

console.log('\n=== ALL STUDENT IMPORT TESTS PASSED ===');
process.exit(0);
