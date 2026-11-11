import { safeGet, setDocument, updateDocument } from './firebase.js';

// ─────────────────────────────────────────────────────────────────────────────
// PER-SCHOOL CONFIGURATION
//
// Config is school-scoped: `schools/{schoolId}/config/{setup|app_config}`.
// Each school has independent setup status, school profile, academic year, and
// term. A school MUST read and write its own configuration.
//
// The top-level `config/` singleton fallback for CONFIG VALUES
// (getConfig / getGradingSettings) has been REMOVED. Silent fallback to
// another school's top-level configuration was a tenant-isolation risk: a
// school whose per-school config was missing would read a different school's
// settings. Missing school configuration now returns an explicit unconfigured
// state instead.
//
// One exception: `isSetupComplete()` called with NO schoolId (cold boot before
// any user is signed in) reads the top-level `config/setup` platform bootstrap
// flag only. This is a one-time "has the platform been set up at all?" signal
// used to decide whether to show the Setup Wizard on first launch. It is NOT a
// per-school config value and does not read any school's configuration. Once a
// schoolId is known, setup status is school-specific (per-school config/setup).
//
// Existing top-level `config/{doc}` documents are NOT deleted (preserving data
// for a future migration), but they are no longer read as a fallback for config
// values. See the Milestone 2.2 completion report for the documented migration
// strategy.
//
// All functions take `schoolId` as a required parameter.
// ─────────────────────────────────────────────────────────────────────────────

const COL_CONFIG   = 'config';
const COL_SCHOOLS  = 'schools';
const DOC_SETUP    = 'setup';
const DOC_APP_CFG  = 'app_config';

/** Per-school config subcollection path: schools/{schoolId}/config */
function schoolConfigPath(schoolId) {
  return `${COL_SCHOOLS}/${schoolId}/config`;
}

// ─────────────────────────────────────────────────────────────────────────────
// READ — per-school only. Missing configuration returns an explicit
// unconfigured state (null / false) rather than falling back to another
// school's top-level configuration.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true only when the given school's per-school setup doc exists and
 * marks setup complete. When called with no schoolId (cold boot before
 * sign-in), reads the top-level config/setup platform bootstrap flag so
 * existing single-school installations are not sent back through the wizard.
 */
export const isSetupComplete = async (schoolId) => {
  if (schoolId) {
    const setup = await safeGet(schoolConfigPath(schoolId), DOC_SETUP);
    return setup?.setupComplete === true;
  }
  // Cold-boot platform bootstrap flag: has ANY school been set up yet?
  const setup = await safeGet(COL_CONFIG, DOC_SETUP);
  return setup?.setupComplete === true;
};

/**
 * Returns the school's per-school app_config document, or null when the
 * school is not yet configured. Never falls back to top-level config/app_config.
 * Callers must handle the null (unconfigured) state explicitly.
 */
export const getConfig = async (schoolId) => {
  if (!schoolId) return null;
  const cfg = await safeGet(schoolConfigPath(schoolId), DOC_APP_CFG);
  return cfg || null;
};

// ─────────────────────────────────────────────────────────────────────────────
// WRITE — createConfig / updateConfig write to the per-school config doc.
// ─────────────────────────────────────────────────────────────────────────────

export const createConfig = async (schoolId, data) => {
  if (!schoolId) throw new Error('schoolId is required to create config.');
  const now = new Date().toISOString();
  const configData = {
    type:          'config',
    schoolId,
    schoolName:    data.schoolName,
    schoolMotto:   data.schoolMotto   || '',
    schoolAddress: data.schoolAddress || '',
    schoolPhone:   data.schoolPhone   || '',
    schoolEmail:   data.schoolEmail   || '',
    academicYear:  data.academicYear,
    currentTerm:   data.currentTerm,
    createdAt:     now,
    updatedAt:     now,
  };
  return await setDocument(schoolConfigPath(schoolId), DOC_APP_CFG, configData);
};

export const updateConfig = async (schoolId, data) => {
  if (!schoolId) throw new Error('schoolId is required to update config.');
  const updates = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  await updateDocument(schoolConfigPath(schoolId), DOC_APP_CFG, updates);
  return await safeGet(schoolConfigPath(schoolId), DOC_APP_CFG);
};
