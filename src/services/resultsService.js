/**
 * Centralized results calculation and dual ranking service
 *
 * All grading now routes through a GradingSystem instance obtained from
 * `getGradingSystem(...)` (see src/gradingSystems/index.js). The legacy UCE
 * path (legacyGrading) is byte-identical to the previous behaviour. The NLSC
 * path (nlscGrading) computes competence-based subject grades (CA/exam/final
 * score, letter A–E, descriptor) with no aggregate or division.
 *
 * - Stream position: rank within same class and stream
 * - Overall class position: rank across all streams in the class
 * Both rankings are delegated to the grading system's `rank()` so legacy and
 * NLSC share the same deterministic sort (score desc, nulls last, admission
 * number tie-break).
 *
 * Stream assignments use the student's classLevel/stream as stored.
 */

import { getExams, getResultsForExam } from '../db/examService.js';
import { getStudents } from '../db/studentService.js';
import { getConfig } from '../db/configService.js';
import { getClassConfig } from '../db/classService.js';
import { getGradingSettings } from '../db/gradingSettingsService.js';
import { getGradingSystem, ASSESSMENT_MODES } from '../gradingSystems/index.js';

const CA_EXAM_TYPES = ['CAT', 'Midterm'];
const EXAM_EXAM_TYPES = ['Final'];

export const computeResultsForClass = async ({ classLevel, academicYear, term, streamFilter = null, schoolId } = {}) => {
  if (!schoolId) throw new Error('schoolId is required to compute results for a class.');
  const streamParam = !streamFilter || streamFilter === 'all' ? undefined : streamFilter.replace(classLevel, '');

  const [studentsAll, allExams] = await Promise.all([
    getStudents({ schoolId, classLevel, stream: streamParam }),
    getExams({ schoolId, academicYear, term }),
  ]);

  // If streamFilter is 'all' or null, get all students in the class across all streams
  let students = studentsAll;
  if (!streamFilter || streamFilter === 'all') {
    students = (await getStudents({ schoolId, classLevel })).filter((s) => s.status === 'active' || s.status !== 'inactive');
    // if some systems mark inactive differently, include all active; be defensive
     if (students.length === 0) {
       students = await getStudents({ schoolId, classLevel });
     }
  } else {
    students = studentsAll;
  }

  // Exams belonging to this class
  const classExams = allExams.filter((e) => {
    if (e.classLevel !== classLevel) return false;
    if (e.classStream === 'all') return true;
    if (!streamFilter || streamFilter === 'all') return true;
    // if specific stream requested, include exams for that stream or for all
    return e.classStream === streamFilter;
  });

  if (classExams.length === 0) {
    return {
      reportCards: [],
      classExams: [],
      subjects: [],
      students: [],
      classLevel,
      stream: streamFilter,
      academicYear,
      term,
    };
  }

  // ── Resolve the grading system for this class ───────────────────────────
  const config = await getConfig(schoolId);
  const currentAcademicYear = config?.academicYear || academicYear;
  const classConfig = academicYear ? await getClassConfig(classLevel, academicYear) : null;
  const settings = await getGradingSettings(schoolId);

  const gradingSystem = getGradingSystem({
    classLevel,
    academicYear,
    classConfig,
    settings,
    currentAcademicYear,
  });
  const isNlsc = gradingSystem.mode === ASSESSMENT_MODES.NLSC;

  const resultArrays = await Promise.all(classExams.map((e) => getResultsForExam(e.id, schoolId)));
  const resultsByExam = {};
  classExams.forEach((exam, i) => {
    resultsByExam[exam.id] = {};
    (resultArrays[i] || []).forEach((r) => {
      resultsByExam[exam.id][r.studentId] = { marks: r.marks, outOf: Number(exam.outOf) };
    });
  });

  // Group by subject
  const subjectMap = {};
  classExams.forEach((exam) => {
    const key = exam.subjectName || exam.subjectId || 'Unknown';
    if (!subjectMap[key]) subjectMap[key] = [];
    subjectMap[key].push(exam);
  });
  const subjects = Object.keys(subjectMap).sort();

  const reportCards = students.map((student) => {
    const subjectGrades = [];
    const subjectRows = subjects.map((subjectName) => {
      const examsForSubject = subjectMap[subjectName];
      const examResults = examsForSubject
        .map((exam) => {
          const r = resultsByExam[exam.id]?.[student.id];
          return r ? { marks: r.marks, outOf: r.outOf, examType: exam.examType, examName: exam.name } : null;
        })
        .filter(Boolean);

      // Legacy totals (sum across all exams for the subject)
      const totalMarks = examResults.length > 0 ? examResults.reduce((s, r) => s + r.marks, 0) : null;
      const totalOutOf = examResults.length > 0 ? examResults.reduce((s, r) => s + r.outOf, 0) : null;

      // NLSC splits: CA = CAT + Midterm ; exam = Final
      let caMarks = null, caOutOf = null, examMarks = null, examOutOf = null;
      if (isNlsc) {
        const caExams = examResults.filter((r) => CA_EXAM_TYPES.includes(r.examType));
        const examExams = examResults.filter((r) => EXAM_EXAM_TYPES.includes(r.examType));
        caMarks  = caExams.length  > 0 ? caExams.reduce((s, r) => s + r.marks, 0) : null;
        caOutOf  = caExams.length  > 0 ? caExams.reduce((s, r) => s + r.outOf, 0) : null;
        examMarks = examExams.length > 0 ? examExams.reduce((s, r) => s + r.marks, 0) : null;
        examOutOf = examExams.length > 0 ? examExams.reduce((s, r) => s + r.outOf, 0) : null;
      }

      // Grade the subject through the grading system interface
      let subjectGrade;
      if (isNlsc) {
        subjectGrade = gradingSystem.gradeSubject({ caMarks, caOutOf, examMarks, examOutOf });
      } else {
        subjectGrade = gradingSystem.gradeSubject({ totalMarks, totalOutOf });
      }
      subjectGrades.push(subjectGrade);

      const row = {
        subjectName,
        examResults,
        totalMarks: examResults.length > 0 ? totalMarks : null,
        totalOutOf: examResults.length > 0 ? totalOutOf : null,
        percentage: isNlsc ? null : (subjectGrade.score ?? null),
        grade: subjectGrade.letter,
        remarks: subjectGrade.descriptor,
        notGraded: subjectGrade.notGraded,
        warning: subjectGrade.warning,
        details: subjectGrade.details,
      };

      if (isNlsc) {
        row.caMarks = caMarks;
        row.caOutOf = caOutOf;
        row.examMarks = examMarks;
        row.examOutOf = examOutOf;
        row.finalScore = subjectGrade.score;
        row.letter = subjectGrade.letter;
        row.descriptor = subjectGrade.descriptor;
      }

      return row;
    });

    // Overall result through the grading system interface
    const overall = gradingSystem.gradeOverall({ subjectGrades });

    // Legacy aggregate fields (byte-identical to previous behaviour)
    const attempted = subjectRows.filter((r) => r.totalMarks !== null);
    const aggMarks = attempted.reduce((s, r) => s + r.totalMarks, 0);
    const aggOutOf = attempted.reduce((s, r) => s + r.totalOutOf, 0);
    const avgPercentage = aggOutOf > 0 ? Math.round((aggMarks / aggOutOf) * 100) : null;

    const streamKey = student.stream
      ? `${student.classLevel}${student.stream}`
      : student.classStream || `${student.classLevel}`;

    const card = {
      student,
      subjectRows,
      // Legacy fields (NLSC leaves these null / '—'; print layer renders NLSC fields instead)
      aggMarks: isNlsc ? null : aggMarks,
      aggOutOf: isNlsc ? null : aggOutOf,
      avgPercentage: isNlsc ? null : avgPercentage,
      overallGrade: isNlsc ? null : (overall.letter ?? '—'),
      overallRemarks: isNlsc ? null : (overall.descriptor ?? ''),
      // NLSC overall fields
      subjectsAtDOrAbove: isNlsc ? overall.subjectsAtDOrAbove : null,
      totalSubjects: isNlsc ? overall.totalSubjects : null,
      certificateEligible: isNlsc ? overall.certificateEligible : false,
      subjectLetters: isNlsc ? overall.subjectLetters : null,
      // Sort score used by ranking: legacy = avgPercentage; NLSC = mean final score
      score: overall.score,
      streamKey,
    };

    return card;
  });

  // Delegate both stream + overall class ranking to the grading system.
  // Sets streamPosition, streamTotal, overallClassPosition, overallClassTotal,
  // position, totalInClass on every card.
  gradingSystem.rank(reportCards);

  return {
    reportCards,
    classExams,
    subjects,
    students,
    classLevel,
    stream: streamFilter,
    academicYear,
    term,
  };
};

export default computeResultsForClass;
