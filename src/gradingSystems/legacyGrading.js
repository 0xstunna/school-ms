/**
 * LEGACY GRADING (UCE — D1 / F9, aggregates, divisions)
 * =====================================================
 *
 * Wraps the existing `src/utils/grading.js` helpers so that the legacy code path
 * produces byte-identical output to before the migration. Nothing here changes
 * how marks, aggregates, divisions or positions are computed.
 *
 * This is the only module that imports from `../utils/grading.js`. All other
 * report/broadcast code goes through the GradingSystem interface.
 */

import {
  getGrade,
  getGradeFromMarks,
  getDivision,
} from '../utils/grading.js';

import { ASSESSMENT_MODES } from './gradingSystemInterface.js';

export const mode = ASSESSMENT_MODES.LEGACY;

/** Legacy has no CA/exam weighting; kept for interface uniformity. */
export const defaultCaWeight = 0;
export const defaultExamWeight = 0;

/**
 * Grade one legacy subject from aggregated exam results.
 *
 * @param {object} input
 * @param {number|null} input.totalMarks   sum of marks across the subject's exams
 * @param {number|null} input.totalOutOf   sum of 'out of' across the subject's exams
 * @returns {SubjectGrade}
 */
export function gradeSubject({ totalMarks, totalOutOf } = {}) {
  if (totalMarks === null || totalMarks === undefined ||
      totalOutOf === null || totalOutOf === undefined || totalOutOf === 0) {
    return {
      letter: '—',
      descriptor: '',
      score: null,
      notGraded: true,
      warning: null,
      details: { marks: null, outOf: null, percentage: null },
    };
  }

  const g = getGradeFromMarks(totalMarks, totalOutOf); // { grade, remarks, percentage, points }

  return {
    letter: g.grade,
    descriptor: g.remarks,
    score: g.percentage,
    notGraded: false,
    warning: null,
    details: { marks: totalMarks, outOf: totalOutOf, percentage: g.percentage },
  };
}

/**
 * Grade a whole learner's legacy result set.
 *
 * Reproduces the existing aggregate behaviour exactly:
 *   aggMarks / aggOutOf over attempted subjects -> avgPercentage -> overall grade.
 *
 * @param {object} input
 * @param {SubjectGrade[]} input.subjectGrades
 * @returns {OverallResult}
 */
export function gradeOverall({ subjectGrades } = {}) {
  const attempted = (subjectGrades || []).filter((sg) => !sg.notGraded && sg.score !== null);

  if (attempted.length === 0) {
    return {
      letter: '—',
      descriptor: 'Not graded',
      score: null,
      subjectsAtDOrAbove: null,
      totalSubjects: (subjectGrades || []).length,
      certificateEligible: false,
      subjectLetters: (subjectGrades || []).map((sg) => sg.letter),
    };
  }

  const aggMarks = attempted.reduce((s, sg) => s + (sg.details && sg.details.marks !== null ? sg.details.marks : 0), 0);
  const aggOutOf = attempted.reduce((s, sg) => s + (sg.details && sg.details.outOf !== null ? sg.details.outOf : 0), 0);

  // Identical to the existing resultsService computation.
  const avgPercentage = aggOutOf > 0 ? Math.round((aggMarks / aggOutOf) * 100) : null;
  const g = avgPercentage !== null ? getGradeFromMarks(aggMarks, aggOutOf) : null;

  return {
    letter: g ? g.grade : '—',
    descriptor: g ? g.remarks : 'Not graded',
    score: avgPercentage, // sort score for ranking
    subjectsAtDOrAbove: null, // not applicable to legacy
    totalSubjects: (subjectGrades || []).length,
    certificateEligible: false, // not applicable to legacy
    subjectLetters: (subjectGrades || []).map((sg) => sg.letter),
  };
}

/**
 * Expose the legacy division helper (still available for any code that needs it,
 * though report cards no longer print a division).
 */
export { getDivision };

/**
 * Rank legacy report cards in place.
 *
 * Mirrors resultsService exactly: sort by avgPercentage desc (nulls last),
 * deterministic admission-number tie-break, null position for ungraded.
 *
 * @param {object[]} reportCards  each card must carry `.score` (avgPercentage),
 *                                `.student.admissionNumber` and `.student.id`
 */
export function rank(reportCards) {
  const cards = reportCards || [];

  // Stream ranking
  const streamGroups = {};
  cards.forEach((card) => {
    const key = card.streamKey || card.stream || '';
    if (!streamGroups[key]) streamGroups[key] = [];
    streamGroups[key].push(card);
  });

  Object.values(streamGroups).forEach((group) => {
    const sorted = [...group].sort(legacyCompare);
    sorted.forEach((card, i) => {
      card.streamPosition = card.score !== null ? i + 1 : null;
      card.streamTotal = group.length;
    });
  });

  // Overall class ranking across all streams
  const classSorted = [...cards].sort(legacyCompare);
  classSorted.forEach((card, i) => {
    card.overallClassPosition = card.score !== null ? i + 1 : null;
    card.overallClassTotal = cards.length;
    // Backward-compatible aliases
    card.position = card.overallClassPosition;
    card.totalInClass = card.overallClassTotal;
  });
}

function legacyCompare(a, b) {
  if (b.score == null && a.score == null) return 0;
  if (b.score == null) return -1;
  if (a.score == null) return 1;
  if (b.score !== a.score) return b.score - a.score;
  const an = a.student && (a.student.admissionNumber || a.student.id) || '';
  const bn = b.student && (b.student.admissionNumber || b.student.id) || '';
  return an.localeCompare(bn);
}

/** Legacy has no UNEB-style certificate rule. */
export function certificateEligible() {
  return false;
}

/** Factory — kept for interface symmetry with createNlscGrading. */
export function createLegacyGrading() {
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
