import { computeResultsForClass } from '../services/resultsService.js';

/**
 * Compiles full report card data for a class/stream in a given term.
 * Uses centralized results service for consistent dual ranking.
 */
export const getReportCardData = async (classLevel, stream, academicYear, term) => {
  return computeResultsForClass({ classLevel, academicYear, term, streamFilter: stream });
};
