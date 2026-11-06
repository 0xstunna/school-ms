/**
 * GRADING VERIFICATION SCRIPT (read-only)
 * =======================================
 *
 * Takes 3 synthetic students with NLSC marks and prints, for each student:
 *   - inputs (per subject: CA marks/out of, exam marks/out of)
 *   - each calculation step (CA %, exam %, final weighted score, letter + descriptor)
 *   - the final overall result (subjects at D or above, certificate eligibility)
 *   - stream position and overall class position
 *
 * Uses the ACTUAL grading logic from src/gradingSystems/nlscGrading.js so the
 * output matches what the app produces. No Firestore, no auth, no writes —
 * plain Node, read-only.
 *
 * EDIT THE MARKS BELOW (the `STUDENTS` array) with the marks you want to verify,
 * then run:  node src/scripts/gradingVerification.js
 */

import { createNlscGrading } from '../gradingSystems/nlscGrading.js';

// ════════════════════════════════════════════════════════════════════════════
// SYNTHETIC INPUTS — REPLACE WITH THE MARKS YOU WANT TO VERIFY
// Each student: name, stream, classLevel, admissionNumber, subjects[].
// Each subject: name, caMarks, caOutOf, examMarks, examOutOf.
// Weights: CA 20% / exam 80% (defaults, admin-editable in Settings → Grading).
// ════════════════════════════════════════════════════════════════════════════
const STUDENTS = [
  {
    name: 'Alice Nakimuli',
    admissionNumber: 'ADM001',
    streamKey: 'S1A',
    classLevel: 'S1',
    stream: 'A',
    subjects: [
      { name: 'Mathematics', caMarks: 38, caOutOf: 40, examMarks: 68, examOutOf: 80 },
      { name: 'English',     caMarks: 30, caOutOf: 40, examMarks: 56, examOutOf: 80 },
      { name: 'Biology',     caMarks: 20, caOutOf: 40, examMarks: 44, examOutOf: 80 },
    ],
  },
  {
    name: 'Brian Okello',
    admissionNumber: 'ADM002',
    streamKey: 'S1A',
    classLevel: 'S1',
    stream: 'A',
    subjects: [
      { name: 'Mathematics', caMarks: 25, caOutOf: 40, examMarks: 40, examOutOf: 80 },
      { name: 'English',     caMarks: 28, caOutOf: 40, examMarks: 48, examOutOf: 80 },
      { name: 'Biology',     caMarks: 15, caOutOf: 40, examMarks: 32, examOutOf: 80 },
    ],
  },
  {
    name: 'Catherine Namale',
    admissionNumber: 'ADM003',
    streamKey: 'S1B',
    classLevel: 'S1',
    stream: 'B',
    subjects: [
      { name: 'Mathematics', caMarks: 39, caOutOf: 40, examMarks: 76, examOutOf: 80 },
      { name: 'English',     caMarks: 35, caOutOf: 40, examMarks: 70, examOutOf: 80 },
      { name: 'Biology',     caMarks: 22, caOutOf: 40, examMarks: 60, examOutOf: 80 },
    ],
  },
];

const NLSC_SETTINGS = {
  caWeight: 0.2,
  examWeight: 0.8,
  certificateRule: { minSubjectsAtDOrAbove: 1 },
  gradeBands: [
    { letter: 'A', min: 80, descriptor: 'exceptional' },
    { letter: 'B', min: 65, descriptor: 'outstanding' },
    { letter: 'C', min: 50, descriptor: 'satisfactory' },
    { letter: 'D', min: 35, descriptor: 'basic' },
    { letter: 'E', min: 0,  descriptor: 'elementary' },
  ],
};

const grading = createNlscGrading(NLSC_SETTINGS);

// ════════════════════════════════════════════════════════════════════════════
// CALCULATION
// ════════════════════════════════════════════════════════════════════════════
const reportCards = STUDENTS.map((s) => {
  const subjectGrades = s.subjects.map((subj) => {
    const result = grading.gradeSubject({
      caMarks: subj.caMarks, caOutOf: subj.caOutOf,
      examMarks: subj.examMarks, examOutOf: subj.examOutOf,
    });
    return { subject: subj.name, ...result };
  });

  const overall = grading.gradeOverall({ subjectGrades });

  return {
    student: { fullName: s.name, admissionNumber: s.admissionNumber },
    streamKey: s.streamKey,
    stream: s.stream,
    subjectGrades,
    overall,
    score: overall.score,
  };
});

// Rank (mutates reportCards with streamPosition / overallClassPosition).
grading.rank(reportCards);

// Group by stream for display.
const byStream = {};
for (const card of reportCards) {
  (byStream[card.streamKey] = byStream[card.streamKey] || []).push(card);
}

// ════════════════════════════════════════════════════════════════════════════
// OUTPUT
// ════════════════════════════════════════════════════════════════════════════
const pad = (s, n) => String(s).padEnd(n);

console.log('==================================================================');
console.log(' NLSC GRADING VERIFICATION (CA 20% + exam 80%, bands A≥80/B≥65/C≥50/D≥35/E≥0)');
console.log('==================================================================\n');

for (const card of reportCards) {
  const { student, streamKey, subjectGrades, overall } = card;
  console.log(`Student: ${student.fullName}  (${student.admissionNumber})  stream ${streamKey}`);
  console.log('-'.repeat(70));
  console.log(
    `${pad('Subject', 16)} ${pad('CA', 10)} ${pad('Exam', 10)} ${pad('Final', 9)} ${pad('Letter', 9)} Descriptor`
  );
  for (const sg of subjectGrades) {
    const ca   = sg.details.caPct   !== null ? `${sg.details.caPct}%`   : '—';
    const exam = sg.details.examPct !== null ? `${sg.details.examPct}%` : '—';
    const final= sg.score           !== null ? sg.score.toFixed(2)       : '—';
    const warn = sg.warning ? `  ⚠ ${sg.warning}` : '';
    console.log(
      `${pad(sg.subject, 16)} ${pad(ca, 10)} ${pad(exam, 10)} ${pad(final, 9)} ${pad(sg.letter, 9)} ${sg.descriptor}${warn}`
    );
  }
  console.log(
    `  Overall: score=${overall.score !== null ? overall.score.toFixed(2) : '—'} | ` +
    `subjects at D or above=${overall.subjectsAtDOrAbove}/${overall.totalSubjects} | ` +
    `certificate eligible=${overall.certificateEligible ? 'YES' : 'NO'}`
  );
  console.log(
    `  Positions: stream ${card.streamPosition}/${card.streamTotal} | ` +
    `overall class ${card.overallClassPosition}/${card.overallClassTotal}`
  );
  console.log();
}

// Stream ranking detail.
console.log('------------------------------------------------------------------');
console.log('STREAM RANKING');
console.log('------------------------------------------------------------------');
for (const [streamKey, group] of Object.entries(byStream)) {
  const sorted = [...group].sort((a, b) => a.streamPosition - b.streamPosition);
  console.log(`Stream ${streamKey}:`);
  for (const card of sorted) {
    const dPlus = card.subjectGrades.filter((g) =>
      g.letter && g.letter !== 'Not graded' && 'EDCBA'.indexOf(g.letter[0]) >= 'EDCBA'.indexOf('D')
    ).length;
    console.log(
      `  ${pad(card.streamPosition, 3)}. ${pad(card.student.fullName, 22)} ` +
      `score=${card.score !== null ? card.score.toFixed(2) : '—'} (D+ ${dPlus})`
    );
  }
  console.log();
}

// Overall class ranking detail.
console.log('------------------------------------------------------------------');
console.log('OVERALL CLASS RANKING (all streams)');
console.log('------------------------------------------------------------------');
const classSorted = [...reportCards].sort((a, b) => a.overallClassPosition - b.overallClassPosition);
for (const card of classSorted) {
  console.log(
    `  ${pad(card.overallClassPosition, 3)}. ${pad(card.student.fullName, 22)} ` +
    `stream ${card.streamKey} score=${card.score !== null ? card.score.toFixed(2) : '—'}`
  );
}
console.log();
