/**
 * PROJECT WORK SERVICE — `projectWork` collection
 * ===============================================
 *
 * New curriculum project work records, shown as a stand-alone line on the NLSC
 * report card and transcript view, separate from subject grades.
 *
 * Document shape:
 * {
 *   type: 'project_work',
 *   id: 'pw_<generated>',
 *   studentId,            // references students.id
 *   year,                 // academic year string
 *   title,                // project title
 *   subjectOrArea,        // subject or learning area
 *   achievementLevel,     // 'A' | 'B' | 'C' | 'D' | 'E' (same bands as subject grades)
 *   assessorId,           // staff/user who assessed
 *   notes,                // free text
 *   createdAt, updatedAt
 * }
 */

import {
  getAllDocs, safeGet, setDocument, updateDocument, deleteDocument, generateId,
} from './firebase.js';

const COL = 'projectWork';

export const ACHIEVEMENT_LEVELS = ['A', 'B', 'C', 'D', 'E'];

/** List project work, optionally filtered by studentId and/or year. */
export const getProjectWork = async (filters = {}) => {
  let results = await getAllDocs(COL);
  if (filters.studentId) results = results.filter((p) => p.studentId === filters.studentId);
  if (filters.year)        results = results.filter((p) => p.year === filters.year);
  return results.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
};

export const getProjectWorkById = async (id) => safeGet(COL, id);

/**
 * Create or replace a project work record (deterministic id per
 * student + year + title keeps re-saving idempotent).
 */
export const saveProjectWork = async (data) => {
  const id = `pw_${data.studentId}_${data.year}_${generateId('pw').slice(-8)}`;
  const now = new Date().toISOString();
  const existing = await safeGet(COL, id);

  const docData = {
    type:            'project_work',
    studentId:       data.studentId,
    year:            data.year,
    title:           data.title.trim(),
    subjectOrArea:   data.subjectOrArea || '',
    achievementLevel: data.achievementLevel || 'E',
    assessorId:      data.assessorId || '',
    notes:           data.notes || '',
    createdAt:       existing ? existing.createdAt : now,
    updatedAt:       now,
  };

  await setDocument(COL, id, docData);
  return { id, ...docData };
};

export const updateProjectWork = async (id, updates) => {
  const existing = await safeGet(COL, id);
  if (!existing) throw new Error('Project work record not found.');
  await updateDocument(COL, id, { ...updates, updatedAt: new Date().toISOString() });
  return safeGet(COL, id);
};

export const deleteProjectWork = async (id) => deleteDocument(COL, id);

/** All project work for one student across all years. */
export const getProjectWorkForStudent = async (studentId) =>
  getProjectWork({ studentId });
