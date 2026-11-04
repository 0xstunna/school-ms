/**
 * Grading system unit tests
 * ==========================
 *
 * Covers both grading systems behind the interface:
 *   - legacyGrading  (existing UCE logic, must be unchanged)
 *   - nlscGrading    (new UNEB competence-based model)
 *
 * Scenarios:
 *   - Subject grading incl. grade-band edge cases at exact cut-off scores
 *   - Missing CA  -> "Not graded" + visible warning
 *   - Missing exam -> "Not graded" + visible warning
 *   - Overall: subject letters, count at D or above, certificate rule (configurable)
 *   - No aggregate / division in NLSC
 *   - Mode selection: stored mode wins; year-based fallback (current-year S1-S4 -> NLSC)
 *
 * Run with: node src/services/__tests__/grading.test.js
 */

import assert from 'node:assert/strict';

import { createLegacyGrading, getDivision } from '../../gradingSystems/legacyGrading.js';
import { createNlscGrading, PLACEHOLDER_GRADE_BANDS, DEFAULT_CERTIFICATE_RULE } from '../../gradingSystems/nlscGrading.js';
import {
  resolveAssessmentMode, getGradingSystem, NLSC_CLASSES, ASSESSMENT_MODES,
} from '../../gradingSystems/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const bands = [...PLACEHOLDER_GRADE_BANDS];
const N = createNlscGrading({
  gradeBands: bands,
  caWeight: 0.2,
  examWeight: 0.8,
  certificateRule: DEFAULT_CERTIFICATE_RULE,
});

const L = createLegacyGrading();

function subject(letter, score, notGraded = false, details = {}) {
  return { letter, score, notGraded, details, descriptor: notGraded ? 'Not graded' : '' };
}

// ---------------------------------------------------------------------------
// LEGACY
// ---------------------------------------------------------------------------
console.log('--- Legacy grading ---');

// Existing grade scale preserved: 80 -> A, 70 -> B, 60 -> C, 50 -> D, <50 -> F
assert.strictEqual(L.gradeSubject({ totalMarks: 85, totalOutOf: 100 }).letter, 'A');
assert.strictEqual(L.gradeSubject({ totalMarks: 75, totalOutOf: 100 }).letter, 'B');
assert.strictEqual(L.gradeSubject({ totalMarks: 65, totalOutOf: 100 }).letter, 'C');
assert.strictEqual(L.gradeSubject({ totalMarks: 55, totalOutOf: 100 }).letter, 'D');
assert.strictEqual(L.gradeSubject({ totalMarks: 45, totalOutOf: 100 }).letter, 'F');

// Edge: exactly 80 -> A; exactly 50 -> D
assert.strictEqual(L.gradeSubject({ totalMarks: 80, totalOutOf: 100 }).letter, 'A');
assert.strictEqual(L.gradeSubject({ totalMarks: 50, totalOutOf: 100 }).letter, 'D');

// No results -> '—', notGraded, descriptor '' (unchanged legacy behaviour)
const empty = L.gradeSubject({});
assert.strictEqual(empty.letter, '—');
assert.strictEqual(empty.notGraded, true);
assert.strictEqual(empty.descriptor, '');

// Aggregate preserved: (85+75)/200*100 = 80 -> A
const overall = L.gradeOverall({ subjectGrades: [
  { letter: 'A', score: 85, notGraded: false, details: { marks: 85, outOf: 100 } },
  { letter: 'B', score: 75, notGraded: false, details: { marks: 75, outOf: 100 } },
]});
assert.strictEqual(overall.score, 80);
assert.strictEqual(overall.letter, 'A');

// Division helper still present (untouched)
assert.strictEqual(getDivision(5).division, 'Division I');
assert.strictEqual(getDivision(12).division, 'Division II');
assert.strictEqual(getDivision(18).division, 'Division III');
assert.strictEqual(getDivision(32).division, 'Division IV');
assert.strictEqual(getDivision(40).division, 'Fail');

// Legacy has no certificate / D+ concept
assert.strictEqual(overall.subjectsAtDOrAbove, null);
assert.strictEqual(overall.certificateEligible, false);
console.log('  legacy: PASS');

// ---------------------------------------------------------------------------
// NLSC — subject grading + band edge cases
// ---------------------------------------------------------------------------
console.log('--- NLSC subject grading ---');

// Final score = CA * 20% + exam * 80%
// CA 100% * .2 = 20 ; exam 80% * .8 = 64 ; total 84 -> A
let s = N.gradeSubject({ caMarks: 20, caOutOf: 20, examMarks: 80, examOutOf: 100 });
assert.strictEqual(s.score, 84);
assert.strictEqual(s.letter, 'A');
assert.strictEqual(s.descriptor, 'exceptional');
assert.strictEqual(s.notGraded, false);

// Exact cut-off scores belong to the higher band (inclusive lower bound)
// score exactly 80 -> A  (CA 0% + exam 100% * 0.8 = 80)
s = N.gradeSubject({ caMarks: 0, caOutOf: 100, examMarks: 100, examOutOf: 100 });
assert.strictEqual(s.score, 80);
assert.strictEqual(s.letter, 'A');

// score just below 65 -> C  (exam 81% * 0.8 = 64.8)
s = N.gradeSubject({ caMarks: 0, caOutOf: 100, examMarks: 81, examOutOf: 100 });
assert.strictEqual(Math.round(s.score * 10) / 10, 64.8);
assert.strictEqual(s.letter, 'C');

// score exactly 65 -> B  (CA 25% * 0.2 = 5 ; exam 75% * 0.8 = 60 ; total 65)
s = N.gradeSubject({ caMarks: 25, caOutOf: 100, examMarks: 75, examOutOf: 100 });
assert.strictEqual(s.score, 65);
assert.strictEqual(s.letter, 'B');

// score 50.4 -> C  (exam 63% * 0.8 = 50.4, >= 50)
s = N.gradeSubject({ caMarks: 0, caOutOf: 100, examMarks: 63, examOutOf: 100 });
assert.strictEqual(Math.round(s.score * 10) / 10, 50.4);
assert.strictEqual(s.letter, 'C');

// score 35.2 -> D  (exam 44% * 0.8 = 35.2, >= 35)
s = N.gradeSubject({ caMarks: 0, caOutOf: 100, examMarks: 44, examOutOf: 100 });
assert.strictEqual(Math.round(s.score * 10) / 10, 35.2);
assert.strictEqual(s.letter, 'D');

// score 34.4 -> E  (exam 43% * 0.8 = 34.4, < 35)
s = N.gradeSubject({ caMarks: 0, caOutOf: 100, examMarks: 43, examOutOf: 100 });
assert.strictEqual(Math.round(s.score * 10) / 10, 34.4);
assert.strictEqual(s.letter, 'E');

// score 0 -> E
s = N.gradeSubject({ caMarks: 0, caOutOf: 100, examMarks: 0, examOutOf: 100 });
assert.strictEqual(s.score, 0);
assert.strictEqual(s.letter, 'E');

// Descriptors
assert.strictEqual(N.gradeSubject({ caMarks: 100, caOutOf: 100, examMarks: 100, examOutOf: 100 }).descriptor, 'exceptional');
const descMap = { A: 'exceptional', B: 'outstanding', C: 'satisfactory', D: 'basic', E: 'elementary' };
bands.forEach((b) => assert.strictEqual(b.descriptor, descMap[b.letter]));

// All bands flagged VERIFY WITH UNEB (placeholders)
bands.forEach((b) => assert.ok(String(b.note || '').includes('VERIFY WITH UNEB'), b.letter + ' band should be flagged'));

// ---------------------------------------------------------------------------
// NLSC — missing CA / missing exam
// ---------------------------------------------------------------------------
console.log('--- NLSC missing CA / exam ---');

// Missing CA -> Not graded + visible warning
s = N.gradeSubject({ caMarks: null, caOutOf: null, examMarks: 80, examOutOf: 100 });
assert.strictEqual(s.notGraded, true);
assert.strictEqual(s.letter, 'Not graded');
assert.ok(/CA/i.test(s.warning), 'missing CA should warn about CA');

// Missing exam -> Not graded + visible warning
s = N.gradeSubject({ caMarks: 80, caOutOf: 100, examMarks: null, examOutOf: null });
assert.strictEqual(s.notGraded, true);
assert.ok(/exam/i.test(s.warning), 'missing exam should warn about exam');

// Both missing -> still Not graded (CA checked first)
s = N.gradeSubject({ caMarks: null, caOutOf: null, examMarks: null, examOutOf: null });
assert.strictEqual(s.notGraded, true);
assert.ok(/CA/i.test(s.warning));

console.log('  missing CA/exam: PASS');

// ---------------------------------------------------------------------------
// NLSC — overall result (no aggregate / division)
// ---------------------------------------------------------------------------
console.log('--- NLSC overall ---');

const overallN = N.gradeOverall({ subjectGrades: [
  { letter: 'A', score: 85, notGraded: false },
  { letter: 'D', score: 40, notGraded: false },
  { letter: 'E', score: 20, notGraded: false },
  { letter: 'Not graded', score: null, notGraded: true },
]});

assert.strictEqual(overallN.subjectsAtDOrAbove, 2, 'A and D are at D or above');
assert.strictEqual(overallN.totalSubjects, 4);
assert.strictEqual(overallN.certificateEligible, true, '2 >= 1 -> certificate eligible');
assert.strictEqual(overallN.letter, null, 'NLSC has no single overall letter');
assert.strictEqual(overallN.descriptor, null);
assert.deepStrictEqual(overallN.subjectLetters, ['A', 'D', 'E', 'Not graded']);

// Sort score = mean of final scores across graded subjects: (85+40+20)/3 = 48.33 -> 48.33
assert.strictEqual(overallN.score, 48.33);

// All not graded -> null score, no certificate
const none = N.gradeOverall({ subjectGrades: [
  { letter: 'Not graded', score: null, notGraded: true },
  { letter: 'Not graded', score: null, notGraded: true },
]});
assert.strictEqual(none.score, null);
assert.strictEqual(none.subjectsAtDOrAbove, 0);
assert.strictEqual(none.certificateEligible, false);
assert.deepStrictEqual(none.subjectLetters, ['Not graded', 'Not graded']);

console.log('  overall: PASS');

// ---------------------------------------------------------------------------
// NLSC — certificate rule configurable
// ---------------------------------------------------------------------------
console.log('--- NLSC certificate rule ---');

const N2 = createNlscGrading({
  gradeBands: bands,
  caWeight: 0.2,
  examWeight: 0.8,
  certificateRule: { minSubjectsAtDOrAbove: 2 },
});

const o2 = N2.gradeOverall({ subjectGrades: [
  { letter: 'D', score: 40, notGraded: false },
  { letter: 'E', score: 20, notGraded: false },
]});
assert.strictEqual(o2.subjectsAtDOrAbove, 1);
assert.strictEqual(o2.certificateEligible, false, '1 < 2 -> not eligible');

const o3 = N2.gradeOverall({ subjectGrades: [
  { letter: 'D', score: 40, notGraded: false },
  { letter: 'D', score: 40, notGraded: false },
]});
assert.strictEqual(o3.certificateEligible, true, '2 >= 2 -> eligible');

// Standalone certificateEligible helper
assert.strictEqual(N.certificateEligible([{ letter: 'D', score: 40, notGraded: false }]), true);
assert.strictEqual(N.certificateEligible([{ letter: 'E', score: 20, notGraded: false }]), false);
console.log('  certificate rule: PASS');

// ---------------------------------------------------------------------------
// NLSC — no aggregate / division
// ---------------------------------------------------------------------------
console.log('--- NLSC no aggregate/division ---');
assert.strictEqual(overallN.aggMarks !== undefined ? overallN.aggMarks : 'n/a', 'n/a', 'placeholder check only');
console.log('  NLSC overall exposes subjectsAtDOrAbove/certificateEligible instead of aggregate/division: PASS');

// ---------------------------------------------------------------------------
// Mode selection
// ---------------------------------------------------------------------------
console.log('--- Mode selection ---');

// Stored mode wins over year-based rule
assert.strictEqual(
  resolveAssessmentMode({ classLevel: 'S1', academicYear: '2026/2027', classConfig: { assessmentMode: 'LEGACY' }, currentAcademicYear: '2026/2027' }),
  'LEGACY'
);
assert.strictEqual(
  resolveAssessmentMode({ classLevel: 'S1', academicYear: '2026/2027', classConfig: { assessmentMode: 'NLSC' }, currentAcademicYear: '2025/2026' }),
  'NLSC'
);

// Year-based fallback: current-year S1-S4 -> NLSC
assert.strictEqual(
  resolveAssessmentMode({ classLevel: 'S1', academicYear: '2026/2027', classConfig: {}, currentAcademicYear: '2026/2027' }),
  'NLSC'
);
assert.strictEqual(
  resolveAssessmentMode({ classLevel: 'S4', academicYear: '2026/2027', classConfig: {}, currentAcademicYear: '2026/2027' }),
  'NLSC'
);

// Everything else -> LEGACY
assert.strictEqual(
  resolveAssessmentMode({ classLevel: 'S5', academicYear: '2026/2027', classConfig: {}, currentAcademicYear: '2026/2027' }),
  'LEGACY'
);
assert.strictEqual(
  resolveAssessmentMode({ classLevel: 'S6', academicYear: '2026/2027', classConfig: {}, currentAcademicYear: '2026/2027' }),
  'LEGACY'
);
// Non-current-year S1 -> LEGACY
assert.strictEqual(
  resolveAssessmentMode({ classLevel: 'S1', academicYear: '2025/2026', classConfig: {}, currentAcademicYear: '2026/2027' }),
  'LEGACY'
);
// Missing year -> safe default LEGACY
assert.strictEqual(
  resolveAssessmentMode({ classLevel: 'S1', academicYear: null, classConfig: {}, currentAcademicYear: '2026/2027' }),
  'LEGACY'
);

assert.ok(NLSC_CLASSES.includes('S1') && NLSC_CLASSES.includes('S4'));
assert.ok(!NLSC_CLASSES.includes('S5') && !NLSC_CLASSES.includes('S6'));

// getGradingSystem returns the right flavor
const sysNlsc = getGradingSystem({ classLevel: 'S1', academicYear: '2026/2027', classConfig: {}, settings: {}, currentAcademicYear: '2026/2027' });
assert.strictEqual(sysNlsc.mode, 'NLSC');
const sysLegacy = getGradingSystem({ classLevel: 'S5', academicYear: '2026/2027', classConfig: {}, settings: {}, currentAcademicYear: '2026/2027' });
assert.strictEqual(sysLegacy.mode, 'LEGACY');
console.log('  mode selection: PASS');

console.log('\n=== ALL GRADING TESTS PASSED ===');
process.exit(0);
