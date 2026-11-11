import { getAllDocs, safeGet, setDocument, deleteDocument, generateId, db } from './firebase.js';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { getGrade } from '../utils/grading.js';

const COL_EXAMS   = 'exams';
const COL_RESULTS = 'exam_results';

// ─────────────────────────────────────────────────────────────────────────────
// Exams
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches exams scoped to the active school via a Firestore `where('schoolId',
 * '==', schoolId)` query so the security rules can satisfy the request.
 * schoolId is REQUIRED — reads without a valid school identity are rejected.
 */
export const getExams = async (filters = {}) => {
  const { schoolId, ...rest } = filters;
  if (!schoolId) {
    throw new Error('schoolId is required to read exams.');
  }
  const snap = await getDocs(
    query(collection(db, COL_EXAMS), where('schoolId', '==', schoolId))
  );
  let results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (rest.classLevel)   results = results.filter((e) => e.classLevel   === rest.classLevel);
  if (rest.academicYear) results = results.filter((e) => e.academicYear === rest.academicYear);
  if (rest.term)         results = results.filter((e) => e.term         === rest.term);
  if (rest.classStream)  results = results.filter(
    (e) => e.classStream === rest.classStream || e.classStream === 'all'
  );
  return results.sort((a, b) => b.date?.localeCompare(a.date || '') || 0);
};

export const getExamById = async (id) => safeGet(COL_EXAMS, id);

/**
 * Creates an exam record tagged with the caller's active school.
 * schoolId is REQUIRED and is immutable after creation (enforced by rules).
 */
export const createExam = async (data, createdBy) => {
  if (!data.schoolId) {
    throw new Error('schoolId is required to create an exam.');
  }
  const id      = generateId('exam');
  const today   = new Date().toISOString().split('T')[0];
  const docData = {
    type:         'exam',
    schoolId:     data.schoolId,            // tenant identity — immutable
    name:         data.name.trim(),
    examType:     data.examType,
    classLevel:   data.classLevel,
    classStream:  data.classStream  || 'all',
    subjectId:    data.subjectId,
    subjectName:  data.subjectName  || '',
    academicYear: data.academicYear,
    term:         data.term,
    date:         data.date         || today,
    outOf:        Number(data.outOf) || 100,
    createdBy,
  };
  await setDocument(COL_EXAMS, id, docData);
  return { id, ...docData };
};

export const deleteExam = async (id) => deleteDocument(COL_EXAMS, id);

// ─────────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches results for an exam, scoped to the active school.
 * schoolId is REQUIRED.
 */
export const getResultsForExam = async (examId, schoolId) => {
  if (!schoolId) {
    throw new Error('schoolId is required to read exam results.');
  }
  const snap = await getDocs(
    query(collection(db, COL_RESULTS), where('schoolId', '==', schoolId))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.examId === examId);
};

/**
 * Fetches results for a student, scoped to the active school.
 * schoolId is REQUIRED.
 */
export const getResultsForStudent = async (studentId, schoolId) => {
  if (!schoolId) {
    throw new Error('schoolId is required to read student results.');
  }
  const snap = await getDocs(
    query(collection(db, COL_RESULTS), where('schoolId', '==', schoolId))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.studentId === studentId);
};

/**
 * Saves a result record tagged with the active school.
 * The deterministic ID `result_{examId}_{studentId}` means saving twice
 * overwrites — historical results are preserved (marks/grades/outOf untouched).
 * schoolId is REQUIRED and cannot be changed on update (immutable).
 */
export const saveResult = async (examId, studentId, marks, outOf, recordedBy, schoolId) => {
  if (!schoolId) {
    throw new Error('schoolId is required to save an exam result.');
  }
  // Deterministic ID: one result per student per exam — saving twice overwrites
  const id         = `result_${examId}_${studentId}`;
  const existing   = await safeGet(COL_RESULTS, id);
  const percentage = outOf > 0 ? Math.min(100, Math.round((marks / outOf) * 100)) : 0;
  const gradeInfo  = getGrade(percentage);

  const docData = {
    type:       'exam_result',
    schoolId,                               // tenant identity — immutable
    examId,
    studentId,
    marks:      Number(marks),
    outOf:      Number(outOf),
    percentage,
    grade:      gradeInfo.grade,
    points:     gradeInfo.points,
    remarks:    gradeInfo.remarks,
    recordedBy,
  };

  await setDocument(COL_RESULTS, id, docData);
  return { id, ...docData };
};

export const bulkSaveResults = async (examId, results, outOf, recordedBy, schoolId) => {
  if (!schoolId) {
    throw new Error('schoolId is required to bulk-save exam results.');
  }
  return Promise.all(results.map((r) => saveResult(examId, r.studentId, r.marks, outOf, recordedBy, schoolId)));
};
