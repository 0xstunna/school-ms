/**
 * NLSC GRADING (UNEB competence-based, lower secondary S1–S4)
 * ===========================================================
 *
 * Source of truth: Parliament statement of 20 Feb 2025 (Minister Peter Ogwang)
 * on UNEB grading under the new curriculum.
 *
 * Model:
 *   Subject final score = CA * caWeight% + exam * examWeight%
 *       (defaults: CA 20 / exam 80, admin-editable via grading settings)
 *   Letter grades with descriptors:
 *       A exceptional, B outstanding, C satisfactory, D basic, E elementary
 *   Grade-band cut-offs live in Firestore `gradingSettings`, seeded as
 *   placeholders flagged "VERIFY WITH UNEB" and editable by admin only.
 *   No aggregate, no division. Overall view lists subject letters and the
 *   count of subjects at D or above.
 *   Certificate: at least one subject at D or above (configurable rule).
 *   Missing CA => "Not graded" with a visible warning.
 */

import { ASSESSMENT_MODES } from './gradingSystemInterface.js';

export const mode = ASSESSMENT_MODES.NLSC;

/** Default weights (admin-editable through grading settings). */
export const defaultCaWeight = 0.2;
export const defaultExamWeight = 0.8;

/** Placeholder bands seeded by the migration. NOT final UNEB cut-offs. */
export const PLACEHOLDER_GRADE_BANDS = [
  { letter: 'A', min: 80, descriptor: 'exceptional',   note: 'VERIFY WITH UNEB' },
  { letter: 'B', min: 65, descriptor: 'outstanding',   note: 'VERIFY WITH UNEB' },
  { letter: 'C', min: 50, descriptor: 'satisfactory',  note: 'VERIFY WITH UNEB' },
  { letter: 'D', min: 35, descriptor: 'basic',         note: 'VERIFY WITH UNEB' },
  { letter: 'E', min: 0,  descriptor: 'elementary',    note: 'VERIFY WITH UNEB' },
];

/** Default certificate rule: at least one subject at D or above. */
export const DEFAULT_CERTIFICATE_RULE = { minSubjectsAtDOrAbove: 1 };

/**
 * Resolve a letter + descriptor from a final score using the configured bands.
 * Bands must be sorted by `min` descending. Exact cut-off scores belong to the
 * higher band (e.g. score 80 -> A).
 *
 * @param {number} score
 * @param {Array<{letter,min,descriptor}} bands
 * @returns {{letter,descriptor}}
 */
function gradeFromScore(score, bands) {
  for (const band of bands) {
    if (score >= band.min) return { letter: band.letter, descriptor: band.descriptor };
  }
  const last = bands[bands.length - 1];
  return { letter: last.letter, descriptor: last.descriptor };
}

/**
 * Is a letter at D or above (i.e. a pass under the NLSC model)?
 * Order: A > B > C > D > E.
 */
const LETTER_RANK = { A: 5, B: 4, C: 3, D: 2, E: 1 };
function isDOrAbove(letter) {
  return (LETTER_RANK[letter] || 0) >= LETTER_RANK.D;
}

/**
 * Build an NLSC grading system from settings.
 *
 * @param {object} settings
 * @param {Array} settings.gradeBands       - band cut-offs (falls back to placeholders)
 * @param {number} settings.caWeight        - CA weight as fraction (default 0.2)
 * @param {number} settings.examWeight      - exam weight as fraction (default 0.8)
 * @param {object} settings.certificateRule - { minSubjectsAtDOrAbove } (default {min:1})
 * @returns {GradingSystem}
 */
export function createNlscGrading(settings = {}) {
  const bands = (settings.gradeBands && settings.gradeBands.length)
    ? [...settings.gradeBands].sort((a, b) => b.min - a.min)
    : [...PLACEHOLDER_GRADE_BANDS];

  const caWeight = Number(settings.caWeight) || defaultCaWeight;
  const examWeight = Number(settings.examWeight) || defaultExamWeight;
  const certificateRule = settings.certificateRule || DEFAULT_CERTIFICATE_RULE;
  const minSubjectsAtDOrAbove = Number(certificateRule.minSubjectsAtDOrAbove) || 1;

  /**
   * Grade one NLSC subject.
   *
   * @param {object} input
   * @param {number|null} input.caMarks    sum of CA marks (CAT/Midterm average)
   * @param {number|null} input.caOutOf    sum of CA 'out of'
   * @param {number|null} input.examMarks  exam marks (Final)
   * @param {number|null} input.examOutOf  exam 'out of'
   * @returns {SubjectGrade}
   */
  function gradeSubject({ caMarks, caOutOf, examMarks, examOutOf } = {}) {
    // Missing CA => Not graded with a visible warning (hard requirement).
    if (caMarks === null || caMarks === undefined ||
        caOutOf === null || caOutOf === undefined || caOutOf === 0) {
      return {
        letter: 'Not graded',
        descriptor: 'Missing continuous assessment (CA)',
        score: null,
        notGraded: true,
        warning: 'Missing CA — subject cannot be graded. Enter CA marks first.',
        details: { caMarks: null, caOutOf: null, caPct: null, examMarks: null, examOutOf: null, examPct: null, finalScore: null },
      };
    }

    const caPct = caOutOf > 0 ? Math.min(100, Math.round((caMarks / caOutOf) * 100)) : 0;

    // Exam is required for a complete competence-based final score.
    if (examMarks === null || examMarks === undefined ||
        examOutOf === null || examOutOf === undefined || examOutOf === 0) {
      return {
        letter: 'Not graded',
        descriptor: 'Missing exam score',
        score: null,
        notGraded: true,
        warning: 'Missing exam score — final score requires both CA and exam.',
        details: { caMarks, caOutOf, caPct, examMarks: null, examOutOf: null, examPct: null, finalScore: null },
      };
    }

    const examPct = examOutOf > 0 ? Math.min(100, Math.round((examMarks / examOutOf) * 100)) : 0;

    // Final score = CA * caWeight% + exam * examWeight%
    const finalScore = Math.round(caPct * caWeight * 100 + examPct * examWeight * 100) / 100;
    const { letter, descriptor } = gradeFromScore(finalScore, bands);

    return {
      letter,
      descriptor,
      score: finalScore,
      notGraded: false,
      warning: null,
      details: { caMarks, caOutOf, caPct, examMarks, examOutOf, examPct, finalScore },
    };
  }

  /**
   * Grade a whole learner's NLSC result set.
   *
   * Overall result view: subject letters + count of subjects at D or above.
   * No aggregate, no division. Sort score = final score for ranking.
   *
   * @param {object} input
   * @param {SubjectGrade[]} input.subjectGrades
   * @returns {OverallResult}
   */
  function gradeOverall({ subjectGrades } = {}) {
    const grades = subjectGrades || [];
    const subjectLetters = grades.map((sg) => sg.letter);
    const graded = grades.filter((sg) => !sg.notGraded && sg.score !== null);
    const subjectsAtDOrAbove = graded.filter((sg) => isDOrAbove(sg.letter)).length;

    // Sort score: average of final scores across graded subjects (null if none).
    const score = graded.length
      ? Math.round((graded.reduce((s, sg) => s + sg.score, 0) / graded.length) * 100) / 100
      : null;

    const certificateEligible = subjectsAtDOrAbove >= minSubjectsAtDOrAbove;

    return {
      letter: null, // NLSC has no single overall letter
      descriptor: null,
      score,
      subjectsAtDOrAbove,
      totalSubjects: grades.length,
      certificateEligible,
      subjectLetters,
    };
  }

  /**
   * Rank NLSC report cards in place by final score (desc, nulls last),
   * deterministic admission-number tie-break.
   *
   * @param {object[]} reportCards
   */
  function rank(reportCards) {
    const cards = reportCards || [];

    const streamGroups = {};
    cards.forEach((card) => {
      const key = card.streamKey || card.stream || '';
      if (!streamGroups[key]) streamGroups[key] = [];
      streamGroups[key].push(card);
    });

    Object.values(streamGroups).forEach((group) => {
      const sorted = [...group].sort(nlscCompare);
      sorted.forEach((card, i) => {
        card.streamPosition = card.score !== null ? i + 1 : null;
        card.streamTotal = group.length;
      });
    });

    const classSorted = [...cards].sort(nlscCompare);
    classSorted.forEach((card, i) => {
      card.overallClassPosition = card.score !== null ? i + 1 : null;
      card.overallClassTotal = cards.length;
      card.position = card.overallClassPosition;
      card.totalInClass = card.overallClassTotal;
    });
  }

  function nlscCompare(a, b) {
    if (b.score == null && a.score == null) return 0;
    if (b.score == null) return -1;
    if (a.score == null) return 1;
    if (b.score !== a.score) return b.score - a.score;
    const an = a.student && (a.student.admissionNumber || a.student.id) || '';
    const bn = b.student && (b.student.admissionNumber || b.student.id) || '';
    return an.localeCompare(bn);
  }

  function certificateEligible(subjectGrades) {
    const grades = subjectGrades || [];
    const graded = grades.filter((sg) => !sg.notGraded && sg.score !== null);
    const subjectsAtDOrAbove = graded.filter((sg) => isDOrAbove(sg.letter)).length;
    return subjectsAtDOrAbove >= minSubjectsAtDOrAbove;
  }

  return {
    mode,
    defaultCaWeight,
    defaultExamWeight,
    gradeSubject,
    gradeOverall,
    rank,
    certificateEligible,
  };
}
