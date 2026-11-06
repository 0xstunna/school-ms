/**
 * DATA EXPORT SERVICE
 * ===================
 *
 * Builds a JSON backup of school data for admin download.
 *
 * Exported collections:
 *   - students
 *   - exams
 *   - exam_results   (results / marks)
 *   - projectWork    (CA / project work, NLSC)
 *   - classes        (class academic config / assessment mode)
 *   - config/app_config  (school settings incl. logo base64)
 *   - config/grading_settings (NLSC bands, CA/exam weights)
 *
 * Excluded (auth data / not part of the academic backup):
 *   - users            (Firebase Auth profiles — auth data, excluded)
 *   - staff, attendance, fee_structures, fee_payments, payroll, expenses
 *
 * The logo base64 (config/app_config.logoUrl) is INCLUDED so the backup is
 * fully restorable (school identity + branding). It makes the file larger but
 * keeps a single self-contained restore artefact.
 */

import { getAllDocs } from './firebase.js';
import { getStudents } from './studentService.js';
import { getExams } from './examService.js';
import { getProjectWork } from './projectWorkService.js';
import { listClasses } from './classService.js';
import { getConfig } from './configService.js';
import { getGradingSettings } from './gradingSettingsService.js';

/**
 * Read every collection to back up and return a JSON-ready object.
 * Throws if any read fails (caller surfaces the error to the admin).
 */
export const exportData = async () => {
  const [
    students,
    exams,
    classes,
    config,
    gradingSettings,
  ] = await Promise.all([
    getStudents(),
    getExams(),
    listClasses(),
    getConfig(),
    getGradingSettings().catch(() => null), // settings may not exist on a fresh DB
  ]);

  // exam_results has no dedicated "get all" getter — read the collection directly.
  const examResults = await getAllDocs('exam_results');

  const projectWork = await getProjectWork();

  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    source: 'alama',
    data: {
      students,
      exams,
      exam_results: examResults,
      projectWork,
      classes,
      config: {
        app_config: config,
        grading_settings: gradingSettings,
      },
    },
  };
};

/**
 * Serialize `data` to JSON and trigger a browser download.
 */
export const downloadJson = (data, filename) => {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
