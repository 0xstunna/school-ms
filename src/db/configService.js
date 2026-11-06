import { safeGet, setDocument, updateDocument } from './firebase.js';

const COL = 'config';
const DOC = 'app_config';
const SETUP_DOC = 'setup';

// ─────────────────────────────────────────────────────────────────────────────
// READ  — isSetupComplete reads config/setup (the first-admin guard flag),
//         which Firestore rules allow WITHOUT authentication so the app can
//         check setup status on every cold boot before any user is signed in.
//         getConfig reads config/app_config (school identity + settings).
// ─────────────────────────────────────────────────────────────────────────────

export const isSetupComplete = async () => {
  const setup = await safeGet(COL, SETUP_DOC);   // reads  →  config/setup
  return setup?.setupComplete === true;
};

export const getConfig = async () => {
  return await safeGet(COL, DOC);                // reads  →  config/app_config
};

// ─────────────────────────────────────────────────────────────────────────────
// WRITE — createConfig writes config/app_config (school identity/settings).
//         setupComplete is NO LONGER stored here — it lives on config/setup,
//         written atomically with the first admin profile in
//         createFirstAdmin() (userService.js). createConfig is called after
//         createFirstAdmin(), when the admin is already signed in, so the
//         admin-only write rule passes.
// ─────────────────────────────────────────────────────────────────────────────

export const createConfig = async (data) => {
  const now = new Date().toISOString();

  // Renamed from 'doc' to 'configData' — avoids shadowing the doc() helper
  // if it were ever imported from firebase/firestore in the future.
  const configData = {
    type:          'config',
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

  return await setDocument(COL, DOC, configData); // writes → config/app_config
};

export const updateConfig = async (data) => {
  const updates = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  await updateDocument(COL, DOC, updates);
  return await safeGet(COL, DOC);
};
