/**
 * CLASS SERVICE — `classes` collection
 * ===================================
 *
 * New collection that stores per-class academic configuration, in particular
 * `assessmentMode` ('LEGACY' | 'NLSC') so the grading system can be selected
 * per class. Introduced for the NLSC migration; existing classes that have no
 * document here fall back to the year-based rule (current-year S1–S4 -> NLSC,
 * everything else -> LEGACY) — see src/gradingSystems/index.js.
 *
 * Documents: { type: 'class', classLevel, academicYear, assessmentMode,
 *              streams: ['A','B',...], updatedAt }
 * ID convention: class_${classLevel}_${academicYear}  (deterministic, idempotent)
 */

import {
  getAllDocs, safeGet, setDocument, updateDocument, deleteDocument, generateId,
} from './firebase.js';

const COL = 'classes';

/** All class levels. Kept here so this service is self-contained. */
export const CLASS_LEVELS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];

/** Valid assessment modes. */
export const ASSESSMENT_MODES = { LEGACY: 'LEGACY', NLSC: 'NLSC' };

function classId(classLevel, academicYear) {
  return `class_${classLevel}_${academicYear}`;
}

/** List every class config document. */
export const listClasses = async () => getAllDocs(COL);

/** Get the config for a single class/year (may be null). */
export const getClassConfig = async (classLevel, academicYear) =>
  safeGet(COL, classId(classLevel, academicYear));

/**
 * Create or update a class config. Admin-only in UI (see Settings page).
 * Never touches students, marks or grades.
 */
export const setClassConfig = async ({ classLevel, academicYear, assessmentMode, streams }) => {
  const id = classId(classLevel, academicYear);
  const now = new Date().toISOString();
  const existing = await safeGet(COL, id);

  const docData = {
    type:          'class',
    classLevel,
    academicYear,
    assessmentMode,
    streams:       streams || [],
    updatedAt:     now,
    ...(existing ? {} : { createdAt: now }),
  };

  await setDocument(COL, id, docData);
  return { id, ...docData };
};

export const updateClassConfig = async (classLevel, academicYear, updates) => {
  const id = classId(classLevel, academicYear);
  const existing = await safeGet(COL, id);
  if (!existing) throw new Error(`Class config not found: ${classLevel} ${academicYear}`);
  await updateDocument(COL, id, { ...updates, updatedAt: new Date().toISOString() });
  return safeGet(COL, id);
};

export const deleteClassConfig = async (classLevel, academicYear) =>
  deleteDocument(COL, classId(classLevel, academicYear));

/** Convenience: resolve the stored assessment mode for a class (or null). */
export const getClassAssessmentMode = async (classLevel, academicYear) => {
  const cfg = await getClassConfig(classLevel, academicYear);
  return cfg && cfg.assessmentMode ? cfg.assessmentMode : null;
};
