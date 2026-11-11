import { computeResultsForClass } from '../services/resultsService.js';

/**
 * Compiles full report card data for a class/stream in a given term.
 * Uses centralized results service for consistent dual ranking.
 *
 * `schoolId` is required — results are scoped to the active school.
 */
export const getReportCardData = async (classLevel, stream, academicYear, term, schoolId) => {
  if (!schoolId) throw new Error('schoolId is required to load report card data.');
  return computeResultsForClass({ classLevel, academicYear, term, streamFilter: stream, schoolId });
};
