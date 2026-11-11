import { safeGet, setDocument, updateDocument, deleteDocument, generateId, db } from './firebase.js';
import { collection, query, where, getDocs } from 'firebase/firestore';

const COL = 'students';

// Fetches student documents scoped to the active school with
// `where('schoolId', '==', schoolId)` so reads never leave the active school
// and the server-side security rules can satisfy the query.
// A schoolId is REQUIRED — academic operations without a valid school identity
// are no longer permitted (transitional fallback removed in Milestone 2).
async function fetchStudents(schoolId) {
  if (!schoolId) {
    throw new Error('schoolId is required to read students.');
  }
  const snap = await getDocs(query(collection(db, COL), where('schoolId', '==', schoolId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Reads are scoped to the active school. A schoolId is required.
export const getStudents = async (filters = {}) => {
  const { schoolId, ...rest } = filters;
  if (!schoolId) {
    throw new Error('schoolId is required to read students.');
  }
  let results = await fetchStudents(schoolId);
  if (rest.classLevel)  results = results.filter((s) => s.classLevel  === rest.classLevel);
  if (rest.stream)      results = results.filter((s) => s.stream      === rest.stream);
  if (rest.classStream) results = results.filter((s) => s.classStream === rest.classStream);
  if (rest.status)      results = results.filter((s) => s.status      === rest.status);
  if (rest.curriculum)  results = results.filter((s) => s.curriculum  === rest.curriculum);
  if (rest.search) {
    const q = rest.search.toLowerCase();
    results = results.filter(
      (s) =>
        s.fullName?.toLowerCase().includes(q) ||
        s.admissionNumber?.toLowerCase().includes(q) ||
        s.referenceId?.toLowerCase().includes(q) ||
        s.schoolpayCode?.toLowerCase().includes(q) ||
        s.curriculum?.toLowerCase().includes(q)
    );
  }
  return results.sort((a, b) => a.fullName?.localeCompare(b.fullName || '') || 0);
};

export const getStudentById = async (id) => safeGet(COL, id);

export const getStudentBySchoolpayCode = async (code) => {
  if (!code) return null;
  return safeGet(COL, String(code).trim());
};

export const createStudent = async (data) => {
  if (!data.schoolId) {
    throw new Error('schoolId is required to create a student.');
  }
  const all = await fetchStudents(data.schoolId);
  const admissionNumber =
    data.admissionNumber?.trim() || `ADM${String(all.length + 1).padStart(4, '0')}`;

  if (all.find((s) => s.admissionNumber === admissionNumber))
    throw new Error('Admission number already exists.');

  const schoolpayCode = (data.schoolpayCode || '').trim();
  const today         = new Date().toISOString().split('T')[0];

  // Brand-new imported students use the SchoolPay code as the Firestore doc ID
  // so the same file can be re-imported idempotently. Manual students keep the
  // existing random ID. Never change existing doc IDs (marks reference them).
  let id, source;
  if (schoolpayCode) {
    const existing = await safeGet(COL, schoolpayCode);
    if (existing) throw new Error(`A student with SchoolPay code ${schoolpayCode} already exists.`);
    id      = schoolpayCode;
    source  = 'schoolpay';
  } else {
    id      = generateId('student');
    source  = 'manual';
  }

  const docData = {
    type:                 'student',
    // Tenant identity: assigned from the caller's active school. Firestore rules
    // require this to match request.auth.token.schoolId on every write.
    schoolId:             data.schoolId,
    schoolpayCode,
    source,
    admissionNumber,
    fullName:             data.fullName.trim(),
    dateOfBirth:          data.dateOfBirth          || '',
    gender:               data.gender               || '',
    classLevel:           data.classLevel,
    stream:               data.stream,
    classStream:          `${data.classLevel}${data.stream}`,
    guardianName:         data.guardianName         || '',
    guardianPhone:        data.guardianPhone        || '',
    guardianRelationship: data.guardianRelationship || '',
    status:               'active',
    enrollmentDate:       data.enrollmentDate       || today,
    notes:                data.notes               || '',
    // New curriculum support — optional, backward-compatible
    curriculum:           data.curriculum           || '',
    referenceId:          data.referenceId          || '',
  };

  await setDocument(COL, id, docData);
  return { id, ...docData };
};

export const updateStudent = async (id, updates) => {
  const existing = await safeGet(COL, id);
  if (!existing) throw new Error('Student not found.');

  // schoolId is immutable — strip it from updates so a client can never change a
  // record's school ownership. The existing schoolId is preserved on the doc.
  const { schoolId, ...rest } = updates;

  const classLevel = rest.classLevel || existing.classLevel;
  const stream     = rest.stream     || existing.stream;

  const payload = {
    ...rest,
    classLevel,
    stream,
    classStream: `${classLevel}${stream}`,
    // schoolpayCode and source are set at creation (import vs manual) and are
    // never changed through the edit form — they override anything in updates.
    schoolpayCode: existing.schoolpayCode || '',
    source:        existing.source || 'manual',
    // Preserve fields if not being updated
    curriculum: rest.curriculum !== undefined ? rest.curriculum : existing.curriculum || '',
    referenceId: rest.referenceId !== undefined ? rest.referenceId : existing.referenceId || '',
  };
  await updateDocument(COL, id, payload);
  return { ...existing, ...payload, id };
};

export const deleteStudent = async (id) => deleteDocument(COL, id);

// Active-student count, scoped to the active school. schoolId is required.
export const getStudentCount = async (schoolId) => {
  if (!schoolId) {
    throw new Error('schoolId is required to count students.');
  }
  const all = await fetchStudents(schoolId);
  return all.filter((s) => s.status === 'active').length;
};
