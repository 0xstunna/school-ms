/**
 * GRADING SETTINGS SERVICE — `config/grading_settings` document
 * ==============================================================
 *
 * NLSC grade-band cut-offs, CA/exam weights and the certificate rule live here.
 * Seeded by the migration as placeholders flagged "VERIFY WITH UNEB" and
 * editable by admin only (Settings → Grading). Legacy grading ignores these.
 *
 * Document shape:
 * {
 *   type: 'grading_settings',
 *   version: 1,
 *   caWeight: 0.2,                      // fraction, admin-editable (default 20%)
 *   examWeight: 0.8,                    // fraction, admin-editable (default 80%)
 *   certificateRule: { minSubjectsAtDOrAbove: 1 },
 *   gradeBands: [                       // sorted by min descending; placeholders flagged VERIFY WITH UNEB
 *     { letter: 'A', min: 80, descriptor: 'exceptional', note: 'VERIFY WITH UNEB' },
 *     { letter: 'B', min: 65, descriptor: 'outstanding', note: 'VERIFY WITH UNEB' },
 *     { letter: 'C', min: 50, descriptor: 'satisfactory', note: 'VERIFY WITH UNEB' },
 *     { letter: 'D', min: 35, descriptor: 'basic', note: 'VERIFY WITH UNEB' },
 *     { letter: 'E', min: 0,  descriptor: 'elementary', note: 'VERIFY WITH UNEB' },
 *   ],
 *   updatedAt, updatedBy
 * }
 */

import { safeGet, setDocument, updateDocument } from './firebase.js';

const COL = 'config';
const DOC = 'grading_settings';

export const getGradingSettings = async () => safeGet(COL, DOC);

export const createOrUpdateGradingSettings = async (data, updatedBy) => {
  const now = new Date().toISOString();
  const existing = await safeGet(COL, DOC);

  const docData = {
    type:            'grading_settings',
    version:         1,
    caWeight:        data.caWeight        !== undefined ? Number(data.caWeight)        : 0.2,
    examWeight:      data.examWeight      !== undefined ? Number(data.examWeight)      : 0.8,
    certificateRule: data.certificateRule || { minSubjectsAtDOrAbove: 1 },
    gradeBands:      Array.isArray(data.gradeBands) && data.gradeBands.length
      ? data.gradeBands
      : [
          { letter: 'A', min: 80, descriptor: 'exceptional',   note: 'VERIFY WITH UNEB' },
          { letter: 'B', min: 65, descriptor: 'outstanding',   note: 'VERIFY WITH UNEB' },
          { letter: 'C', min: 50, descriptor: 'satisfactory',  note: 'VERIFY WITH UNEB' },
          { letter: 'D', min: 35, descriptor: 'basic',         note: 'VERIFY WITH UNEB' },
          { letter: 'E', min: 0,  descriptor: 'elementary',    note: 'VERIFY WITH UNEB' },
        ],
    updatedAt: now,
    updatedBy,
    ...(existing ? {} : { createdAt: now }),
  };

  await setDocument(COL, DOC, docData);
  return { id: DOC, ...docData };
};

export const updateGradingSettings = async (updates, updatedBy) => {
  const existing = await safeGet(COL, DOC);
  if (!existing) throw new Error('Grading settings not initialized. Run setup/migration first.');
  await updateDocument(COL, DOC, {
    ...updates,
    updatedAt: new Date().toISOString(),
    updatedBy,
  });
  return safeGet(COL, DOC);
};

/** Default (placeholder) bands — exported so the migration can seed them. */
export const DEFAULT_GRADE_BANDS = [
  { letter: 'A', min: 80, descriptor: 'exceptional',   note: 'VERIFY WITH UNEB' },
  { letter: 'B', min: 65, descriptor: 'outstanding',   note: 'VERIFY WITH UNEB' },
  { letter: 'C', min: 50, descriptor: 'satisfactory',  note: 'VERIFY WITH UNEB' },
  { letter: 'D', min: 35, descriptor: 'basic',         note: 'VERIFY WITH UNEB' },
  { letter: 'E', min: 0,  descriptor: 'elementary',    note: 'VERIFY WITH UNEB' },
];

export const DEFAULT_CERTIFICATE_RULE = { minSubjectsAtDOrAbove: 1 };
export const DEFAULT_CA_WEIGHT = 0.2;
export const DEFAULT_EXAM_WEIGHT = 0.8;
