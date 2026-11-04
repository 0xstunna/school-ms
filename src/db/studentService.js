import { getAllDocs, safeGet, setDocument, updateDocument, deleteDocument, generateId } from './firebase.js';

const COL = 'students';

export const getStudents = async (filters = {}) => {
  let results = await getAllDocs(COL);
  if (filters.classLevel)  results = results.filter((s) => s.classLevel  === filters.classLevel);
  if (filters.stream)      results = results.filter((s) => s.stream      === filters.stream);
  if (filters.classStream) results = results.filter((s) => s.classStream === filters.classStream);
  if (filters.status)      results = results.filter((s) => s.status      === filters.status);
  if (filters.curriculum)  results = results.filter((s) => s.curriculum  === filters.curriculum);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    results = results.filter(
      (s) =>
        s.fullName?.toLowerCase().includes(q) ||
        s.admissionNumber?.toLowerCase().includes(q) ||
        s.referenceId?.toLowerCase().includes(q) ||
        s.curriculum?.toLowerCase().includes(q)
    );
  }
  return results.sort((a, b) => a.fullName?.localeCompare(b.fullName || '') || 0);
};

export const getStudentById = async (id) => safeGet(COL, id);

export const createStudent = async (data) => {
  const all = await getAllDocs(COL);
  const admissionNumber =
    data.admissionNumber?.trim() || `ADM${String(all.length + 1).padStart(4, '0')}`;

  if (all.find((s) => s.admissionNumber === admissionNumber))
    throw new Error('Admission number already exists.');

  const id      = generateId('student');
  const today   = new Date().toISOString().split('T')[0];
  const docData = {
    type:                 'student',
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

  const classLevel = updates.classLevel || existing.classLevel;
  const stream     = updates.stream     || existing.stream;

  const payload = {
    ...updates,
    classLevel,
    stream,
    classStream: `${classLevel}${stream}`,
    // Preserve new fields if not being updated
    curriculum: updates.curriculum !== undefined ? updates.curriculum : existing.curriculum || '',
    referenceId: updates.referenceId !== undefined ? updates.referenceId : existing.referenceId || '',
  };
  await updateDocument(COL, id, payload);
  return { ...existing, ...payload, id };
};

export const deleteStudent = async (id) => deleteDocument(COL, id);

export const getStudentCount = async () => {
  const all = await getAllDocs(COL);
  return all.filter((s) => s.status === 'active').length;
};
