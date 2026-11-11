/**
 * GRADING SETTINGS SERVICE — per-school `schools/{schoolId}/config/grading_settings`
 * ================================================================================
 *
 * NLSC grade-band cut-offs, CA/exam weights and the certificate rule live here.
 * Seeded by the migration as placeholders flagged "VERIFY WITH UNEB" and
 * editable by admin only (Settings → Grading). Legacy grading ignores these.
 *
 * Each school has its own grading settings document. A school MUST read and
 * write its own grading settings.
 *
 * The top-level `config/grading_settings` fallback has been REMOVED. Silent
 * fallback to another school's grading settings was a tenant-isolation risk.
 * Missing school grading settings now returns an explicit unconfigured state
 * (null) instead of silently using another school's values.
 *
 * Existing top-level `config/grading_settings` is NOT deleted (preserving data
 * for a future migration) but is no longer read as a fallback.
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

const COL_CONFIG   = 'config';
const COL_SCHOOLS  = 'schools';
const DOC_GRADING  = 'grading_settings';

function schoolConfigPath(schoolId) {
  return `${COL_SCHOOLS}/${schoolId}/config`;
}

export const getGradingSettings = async (schoolId) => {
  if (!schoolId) return null;
  const settings = await safeGet(schoolConfigPath(schoolId), DOC_GRADING);
  return settings || null;
};

export const createOrUpdateGradingSettings = async (schoolId, data, updatedBy) => {
  if (!schoolId) throw new Error('schoolId is required to write grading settings.');
  const now = new Date().toISOString();
  const existing = await getGradingSettings(schoolId);

  const docData = {
    type:            'grading_settings',
    schoolId,
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

  await setDocument(schoolConfigPath(schoolId), DOC_GRADING, docData);
  return { id: DOC_GRADING, ...docData };
};

export const updateGradingSettings = async (schoolId, updates, updatedBy) => {
  if (!schoolId) throw new Error('schoolId is required to update grading settings.');
  const existing = await getGradingSettings(schoolId);
  if (!existing) throw new Error('Grading settings not initialized. Run setup/migration first.');
  await updateDocument(schoolConfigPath(schoolId), DOC_GRADING, {
    ...updates,
    updatedAt: new Date().toISOString(),
    updatedBy,
  });
  return safeGet(schoolConfigPath(schoolId), DOC_GRADING);
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
