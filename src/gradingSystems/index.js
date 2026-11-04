/**
 * GRADING SYSTEM FACTORY / SELECTOR
 * =================================
 *
 * Picks the grading model for a class:
 *   1. If the class has a stored `assessmentMode` ('LEGACY' | 'NLSC'), use it.
 *   2. Otherwise fall back to the year-based rule:
 *        current-year S1–S4 classes -> NLSC
 *        everything else            -> LEGACY
 *   3. Never rewrite existing marks or grades; the mode only affects how
 *      results are computed and rendered going forward.
 *
 * `classConfig` is the document from the `classes` collection
 * (see src/db/classService.js) and carries `{ assessmentMode, academicYear, ... }`.
 * `settings` is the `gradingSettings` doc used by NLSC.
 */

import { createLegacyGrading } from './legacyGrading.js';
import { createNlscGrading } from './nlscGrading.js';
import { ASSESSMENT_MODES } from './gradingSystemInterface.js';

// Classes currently in the new lower-secondary curriculum (S1–S4).
export const NLSC_CLASSES = ['S1', 'S2', 'S3', 'S4'];

/**
 * Is this class-level/year combo expected to be NLSC under the year-based rule?
 * Current-year S1–S4 -> NLSC; everything else -> LEGACY.
 * `currentAcademicYear` should be the school's current academic year (from config).
 */
export function isYearBasedNLSC({ classLevel, academicYear, currentAcademicYear }) {
  if (!NLSC_CLASSES.includes(classLevel)) return false;
  if (!academicYear || !currentAcademicYear) return false;
  return academicYear === currentAcademicYear;
}

/**
 * Resolve the assessment mode for a class.
 *
 * @param {object} opts
 * @param {string} opts.classLevel
 * @param {string} opts.academicYear
 * @param {object} opts.classConfig        - `classes` doc; may be null/undefined
 * @param {string} opts.currentAcademicYear
 * @returns {'LEGACY'|'NLSC'}
 */
export function resolveAssessmentMode({ classLevel, academicYear, classConfig, currentAcademicYear } = {}) {
  // 1. Stored mode on the class takes precedence (set by migration or admin).
  if (classConfig && classConfig.assessmentMode) {
    const m = String(classConfig.assessmentMode).toUpperCase();
    if (m === ASSESSMENT_MODES.LEGACY || m === ASSESSMENT_MODES.NLSC) return m;
  }

  // 2. Year-based fallback.
  return isYearBasedNLSC({ classLevel, academicYear, currentAcademicYear })
    ? ASSESSMENT_MODES.NLSC
    : ASSESSMENT_MODES.LEGACY;
}

/**
 * Build a GradingSystem for a class.
 *
 * @param {object} opts
 * @param {object} opts.classConfig
 * @param {object} opts.settings           - gradingSettings (NLSC bands/weights/rule)
 * @param {string} opts.currentAcademicYear
 * @returns {GradingSystem}
 */
export function getGradingSystem({ classConfig, settings, currentAcademicYear, classLevel, academicYear } = {}) {
  const mode = resolveAssessmentMode({
    classLevel,
    academicYear,
    classConfig,
    currentAcademicYear,
  });

  if (mode === ASSESSMENT_MODES.NLSC) {
    return createNlscGrading(settings);
  }
  return createLegacyGrading();
}

export { ASSESSMENT_MODES, createLegacyGrading, createNlscGrading };
