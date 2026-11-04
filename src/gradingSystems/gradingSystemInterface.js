/**
 * GRADING SYSTEM INTERFACE
 * ========================
 *
 * Single contract behind which both grading models live:
 *   - LEGACY : old UCE model (D1-F9, aggregates, divisions) — untouched logic
 *   - NLSC   : new UNEB competence-based model (A-E, no aggregate/division)
 *
 * Every report / broadsheet / print module calls methods on a GradingSystem
 * instance obtained from `getGradingSystem(...)`. None of them call the old
 * `src/utils/grading.js` helpers directly (legacyGrading is the only place
 * that does, and it preserves the existing behaviour exactly).
 */

/** Selection key stored on a class and used to pick the grading model. */
export const ASSESSMENT_MODES = {
  LEGACY: 'LEGACY',
  NLSC:   'NLSC',
};

/**
 * @typedef {object} SubjectGrade
 * @property {string}   letter        - letter grade (A..F | A..E | '—' | 'Not graded')
 * @property {string}   descriptor    - human-readable descriptor
 * @property {number|null} score      - 0-100 numeric score; null when not graded
 * @property {boolean}  notGraded     - true when the result cannot be computed
 * @property {string|null} warning    - user-facing warning when notGraded
 * @property {object}   details       - mode-specific breakdown (marks/outOf/weights/…)
 */

/**
 * @typedef {object} OverallResult
 * @property {string|null} letter                   - overall letter (legacy overall grade; NLSC: n/a)
 * @property {string|null} descriptor
 * @property {number|null} score                    - sort score used for ranking
 * @property {number|null} subjectsAtDOrAbove       - NLSC: count of subjects graded D or above
 * @property {number|null} totalSubjects
 * @property {boolean}   certificateEligible
 * @property {string[]}  subjectLetters             - letters per subject (overall result view)
 */

/**
 * GradingSystem — one implementation per assessment mode.
 *
 *   mode            'LEGACY' | 'NLSC'
 *   gradeSubject(input)          -> SubjectGrade     grade one subject from raw inputs
 *   gradeOverall({subjectGrades})-> OverallResult    grade a whole learner's result set
 *   rank(reportCards)            -> void             mutates cards with stream+overall position
 *   certificateEligible(subjectGrades) -> boolean    NLSC certificate rule
 *   defaultCaWeight / defaultExamWeight (NLSC only)
 */
