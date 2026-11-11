/**
 * SERVER-ONLY — Multi-tenant school provisioning.
 *
 * `provisionSchool(schoolData, provisionerUid)` creates a new school tenant and
 * its first administrator membership, entirely server-side. No Admin SDK
 * operation is exposed to the frontend.
 *
 * Flow:
 *   1. Authorize the provisioner (must be a platform administrator).
 *   2. Validate school + first-admin inputs.
 *   3. Create schools/{schoolId} (tenant root).
 *   4. Create the first admin's Firebase Auth account.
 *   5. Write the admin's users/{uid} profile with school membership.
 *   6. Set Firebase Auth custom claims (schoolId, schoolIds, role, ...).
 *   7. Seed per-school config placeholder (config/setup pending).
 *
 * On any failure after step 3, the function attempts to roll back everything
 * created so far so no partially provisioned account or orphaned tenant is
 * left behind.
 *
 * This module is imported only by server-side code. It is never bundled into
 * the browser/Electron client.
 */

import { getAdminAuth, getAdminDb } from './admin.js';
import { membershipsFromProfile } from '../lib/memberships.js';

const COL_SCHOOLS = 'schools';
const COL_USERS   = 'users';
const DOC_SETUP   = 'setup';
const DOC_APP_CFG = 'app_config';

const ROLE_ADMIN = 'admin';

// ─────────────────────────────────────────────────────────────────────────────
// INPUT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateSchoolData(schoolData) {
  const errors = [];

  if (!schoolData || typeof schoolData !== 'object') {
    throw new Error('schoolData is required.');
  }

  const {
    schoolName, schoolEmail, schoolAddress, schoolPhone,
    academicYear, currentTerm, plan = 'trial',
    adminFullName, adminEmail, adminPassword,
  } = schoolData;

  if (!isNonEmptyString(schoolName))      errors.push('schoolName is required.');
  if (!isNonEmptyString(adminFullName))   errors.push('adminFullName is required.');
  if (!isNonEmptyString(adminEmail) || !EMAIL_RE.test(adminEmail.trim())) {
    errors.push('adminEmail must be a valid email address.');
  }
  if (!isNonEmptyString(adminPassword) || adminPassword.trim().length < 8) {
    errors.push('adminPassword must be at least 8 characters.');
  }
  if (!isNonEmptyString(academicYear))    errors.push('academicYear is required.');
  if (!isNonEmptyString(currentTerm))     errors.push('currentTerm is required.');
  if (!['trial', 'starter', 'school'].includes(plan)) {
    errors.push("plan must be one of 'trial', 'starter', 'school'.");
  }

  if (schoolEmail && !EMAIL_RE.test(schoolEmail.trim())) {
    errors.push('schoolEmail must be a valid email address.');
  }

  if (errors.length > 0) throw new Error(errors.join(' '));
  return {
    schoolName:    schoolName.trim(),
    schoolEmail:   (schoolEmail || '').trim() || null,
    schoolAddress: (schoolAddress || '').trim(),
    schoolPhone:   (schoolPhone || '').trim(),
    academicYear:  academicYear.trim(),
    currentTerm:   currentTerm.trim(),
    plan,
    adminFullName: adminFullName.trim(),
    adminEmail:    adminEmail.toLowerCase().trim(),
    adminPassword: adminPassword.trim(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHOOL ID (server-generated, opaque tenant identifier)
// ─────────────────────────────────────────────────────────────────────────────
//
// School IDs are generated server-side and are unique tenant identifiers. They
// are NOT derived from the school name (slugify is used only for the optional,
// human-readable schoolSlug field stored separately on the school doc). This
// prevents tenant IDs from being guessable and keeps the readable name and any
// slug distinct from the internal identifier. Uniqueness is guaranteed by
// checking against existing schools/{schoolId} documents.

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'school';
}

async function nextAvailableSchoolId(db) {
  let attempts = 0;
  while (attempts < 1000) {
    attempts += 1;
    const ts   = Date.now().toString(36);
    const rnd  = Math.random().toString(36).slice(2, 8);
    const schoolId = `sch_${ts}_${rnd}`;
    const snap = await db.collection(COL_SCHOOLS).doc(schoolId).get();
    if (!snap.exists) return schoolId;
  }
  throw new Error('Unable to generate a unique school ID.');
}

// ─────────────────────────────────────────────────────────────────────────────
// ROLLBACK HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempts to delete every resource created so far during provisioning.
 * Swallows individual errors — the goal is best-effort cleanup, then re-throw
 * the original provisioning error.
 */
async function rollback({ db, auth, schoolId, authUid, created }) {
  const errors = [];
  // 1. Remove the users/{uid} profile if it was written.
  if (created.profile && authUid) {
    try { await db.collection(COL_USERS).doc(authUid).delete(); } catch (e) { errors.push(e.message); }
  }
  // 2. Remove the Firebase Auth account if it was created.
  if (created.authUser && authUid) {
    try { await auth.deleteUser(authUid); } catch (e) { errors.push(e.message); }
  }
  // 3. Remove the schools/{schoolId} document if it was created.
  if (created.schoolDoc && schoolId) {
    try { await db.collection(COL_SCHOOLS).doc(schoolId).delete(); } catch (e) { errors.push(e.message); }
  }
  if (errors.length > 0) {
    console.error('[provisioning] rollback cleanup errors:', errors.join('; '));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAIMS BUILDER
//
// Custom claims are intentionally small: only the active school, its role,
// global active flag, and platformAdmin flag. Per-school memberships
// (schoolIds[], roles{}, membershipActive{}) live on the users/{uid} profile
// (source of truth) and are validated server-side when the active school
// changes. This keeps claims well under Firebase's 1,000-byte custom-claims
// limit regardless of how many schools a user belongs to.
// ─────────────────────────────────────────────────────────────────────────────

function buildClaims(schoolId, role, activeMembership, active, platformAdmin) {
  return {
    schoolId,
    role,
    am: activeMembership === true,
    active: active === true,
    platformAdmin: platformAdmin === true,
  };
}

/**
 * Build per-school membership entries from a user profile.
 * @returns {Array<{ schoolId, role, active }>}
 */
// Defined in src/lib/memberships.js and imported above — shared with client code.

// ─────────────────────────────────────────────────────────────────────────────
// PROVISION SCHOOL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a school tenant and its first administrator membership.
 *
 * @param {object} schoolData
 *   { schoolName, schoolEmail?, schoolAddress?, schoolPhone?,
 *     academicYear, currentTerm, plan?,
 *     adminFullName, adminEmail, adminPassword }
 * @param {string} provisionerUid — Firebase Auth UID of the platform
 *   administrator requesting this provisioning. Must have platformAdmin claim.
 * @returns {Promise<{ schoolId, school, adminUserId, adminEmail }>}
 */
export async function provisionSchool(schoolData, provisionerUid) {
  const auth = getAdminAuth();
  const db   = getAdminDb();

  if (!provisionerUid || typeof provisionerUid !== 'string') {
    throw new Error('provisionerUid is required.');
  }

  // ── 1. Authorize: only a platform administrator may provision schools. ──
  let provisioner;
  try {
    provisioner = await auth.getUser(provisionerUid);
  } catch (e) {
    throw new Error('Provisioner account not found.');
  }
  const provisionerClaims = (provisioner.customClaims || {});
  if (provisionerClaims.platformAdmin !== true) {
    throw new Error('Only a platform administrator can provision a school.');
  }

  // ── 2. Validate inputs. ──
  const data = validateSchoolData(schoolData);

  // ── 3. Prevent duplicate school email / first-admin email collisions. ──
  if (data.schoolEmail) {
    try {
      await auth.getUserByEmail(data.schoolEmail);
      throw new Error('A school with this email already exists.');
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        // expected — email is free
      } else {
        throw e;
      }
    }
  }
  try {
    await auth.getUserByEmail(data.adminEmail);
    throw new Error('A user with this admin email already exists.');
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }

  // ── 4. Generate a unique server-side school ID. ──
  const schoolId = await nextAvailableSchoolId(db);
  const now = new Date().toISOString();

  // Rollback state, populated as resources are created.
  let authUid = null;
  const created = { schoolDoc: false, authUser: false, profile: false };

  try {
    // ── 5. Create the tenant root: schools/{schoolId}. ──
    await db.collection(COL_SCHOOLS).doc(schoolId).set({
      type:           'school',
      schoolId,
      schoolName:     data.schoolName,
      schoolSlug:     slugify(data.schoolName),   // human-readable, separate from the internal ID
      schoolEmail:    data.schoolEmail,
      schoolAddress:  data.schoolAddress,
      schoolPhone:    data.schoolPhone,
      academicYear:   data.academicYear,
      currentTerm:    data.currentTerm,
      plan:           data.plan,
      status:         'active',
      provisionedBy:  provisionerUid,
      provisionedAt:  now,
      updatedAt:      now,
    });
    created.schoolDoc = true;

    // ── 6. Create the first administrator's Firebase Auth account. ──
    const authRecord = await auth.createUser({
      email:      data.adminEmail,
      password:   data.adminPassword,
      displayName: data.adminFullName,
      emailVerified: false,
    });
    authUid = authRecord.uid;
    created.authUser = true;

    // ── 7. Write the admin's Firestore profile (source of truth). ──
    const profile = {
      type:              'user',
      uid:               authUid,
      fullName:          data.adminFullName,
      email:             data.adminEmail,
      role:              ROLE_ADMIN,            // role in the active school
      schoolId,                                 // active school
      schoolIds:         [schoolId],            // every school the user belongs to
      membershipActive:  { [schoolId]: true },
      active:            true,                  // globally active
      platformAdmin:     false,                 // school admin, NOT platform admin
      assignedClasses:   [],
      createdBy:         provisionerUid,
      createdAt:         now,
      updatedAt:         now,
    };
    await db.collection(COL_USERS).doc(authUid).set(profile);
    created.profile = true;

    // ── 8. Set Firebase Auth custom claims (runtime authority for rules). ──
    await auth.setCustomUserClaims(authUid, buildClaims(schoolId, ROLE_ADMIN, true, true, false));

    // ── 9. Seed per-school config placeholder (setup pending). ──
    //    The Setup Wizard (scoped to schoolId) completes config/app_config and
    //    marks config/setup complete for this school. Setup status is stored
    //    per-school (schools/{schoolId}/config/setup), never at top-level config/.
    await db.collection(COL_SCHOOLS).doc(schoolId).collection('config').doc(DOC_SETUP).set({
      type:           'setup',
      schoolId,
      setupComplete:  false,
      createdBy:      provisionerUid,
      createdAt:      now,
      updatedAt:      now,
    });

    return {
      schoolId,
      school: {
        schoolId,
        schoolName: data.schoolName,
        status: 'active',
        plan: data.plan,
      },
      adminUserId: authUid,
      adminEmail: data.adminEmail,
    };
  } catch (e) {
    // ── Rollback: no partially provisioned accounts or orphaned tenants. ──
    await rollback({ db, auth, schoolId, authUid, created });
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SET ACTIVE SCHOOL (claims refresh for school switching)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Updates a user's active school and re-issues their Firebase Auth custom
 * claims so the active school is reflected in the ID token. Called server-side
 * (e.g. from a Cloud Function) after the client requests a school switch.
 *
 * Authorization: the caller must be the user themselves (callerUid === uid)
 * or a platform administrator. This prevents a user from switching another
 * user's active school.
 *
 * @param {string} callerUid — Firebase Auth UID of the caller making the
 *   request. Must be the user themselves or a platform administrator.
 * @param {string} uid — Firebase Auth UID of the user switching schools.
 * @param {string} schoolId — school to make active (must be in user's
 *   schoolIds with an active membership).
 * @returns {Promise<{ claims, profile }>}
 */
export async function setActiveSchoolClaims(callerUid, uid, schoolId) {
  const auth = getAdminAuth();
  const db   = getAdminDb();

  if (!callerUid || !uid || !schoolId) throw new Error('callerUid, uid and schoolId are required.');

  // ── Authorization: caller must be the user or a platform administrator. ──
  if (callerUid !== uid) {
    let caller;
    try {
      caller = await auth.getUser(callerUid);
    } catch (e) {
      throw new Error('Caller account not found.');
    }
    const callerClaims = (caller.customClaims || {});
    if (callerClaims.platformAdmin !== true) {
      throw new Error('Only the user or a platform administrator can switch the active school.');
    }
  }

  const profileSnap = await db.collection(COL_USERS).doc(uid).get();
  if (!profileSnap.exists) throw new Error('User profile not found.');
  const profile = profileSnap.data();

  // Prevent switching to a school the user does not belong to.
  const schoolIds = profile.schoolIds || [];
  if (!schoolIds.includes(schoolId)) {
    throw new Error('User is not a member of this school.');
  }

  // Prevent switching to a school with an inactive membership.
  const membershipActive = profile.membershipActive || {};
  if (membershipActive[schoolId] === false) {
    throw new Error('Membership in this school is inactive.');
  }

  // Check the school is operational (not suspended/closed).
  const schoolSnap = await db.collection(COL_SCHOOLS).doc(schoolId).get();
  if (schoolSnap.exists) {
    const schoolStatus = schoolSnap.data()?.status;
    if (schoolStatus && schoolStatus !== 'active') {
      throw new Error('School is ' + schoolStatus + '.');
    }
  }

  // Update the profile's active school.
  const now = new Date().toISOString();
  await db.collection(COL_USERS).doc(uid).update({
    schoolId,
    updatedAt: now,
  });

  // Build claims for the new active school.
  // Only the active school + its role + global flags go into claims (small).
  // Per-school memberships/roles live on the users/{uid} profile.
  const targetRole = ((profile.roles || {})[schoolId] || [profile.role || 'teacher'])[0];
  const claims = {
    schoolId,
    role: targetRole,
    am: membershipActive[schoolId] !== false,
    active: profile.active !== false,
    platformAdmin: profile.platformAdmin === true,
  };

  await auth.setCustomUserClaims(uid, claims);

  return {
    claims,
    profile: { ...profile, schoolId },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-SERVICE SCHOOL ONBOARDING
//
// `onboardSchool(schoolData, idempotencyKey)` is the backend workflow for
// self-service school onboarding. A brand-new school signs itself up and
// creates its first administrator — no platform administrator and no
// authenticated caller is required (there is no platform admin yet on a fresh
// tenant).
//
// A successful onboarding operation:
//   1. Validates the school information.
//   2. Checks the idempotency key (prevents duplicate submissions).
//   3. Prevents duplicate admin-email / school-email accounts.
//   4. Generates a unique server-side school identity.
//   5. Creates the school record (schools/{schoolId}).
//   6. Creates the first administrator's Firebase Auth account.
//   7. Writes the admin's Firestore profile + school membership.
//   8. Assigns active-school custom claims.
//   9. Creates school-specific configuration (config/app_config + config/setup).
//  On any failure after step 5, everything created so far is rolled back so no
// partially provisioned account or orphaned tenant is left behind.
//
// Billing is intentionally NOT part of onboarding (deferred).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Onboards a new school tenant (self-service).
 *
 * @param {object} schoolData
 *   { schoolName, schoolEmail?, schoolAddress?, schoolPhone?,
 *     academicYear, currentTerm, plan?,
 *     adminFullName, adminEmail, adminPassword }
 * @param {string} idempotencyKey — client-generated key that makes repeat
 *   submissions of the same onboarding request return the existing school
 *   instead of creating a duplicate.
 * @returns {Promise<{ schoolId, school, adminUserId, adminEmail,
 *   setupComplete, alreadyOnboarded }>}
 */
export async function onboardSchool(schoolData, idempotencyKey, deps = {}) {
  const auth = deps.auth || getAdminAuth();
  const db = deps.db || getAdminDb();

  if (!schoolData || typeof schoolData !== 'object') {
    throw new Error('schoolData is required.');
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    throw new Error('idempotencyKey is required.');
  }
  const key = idempotencyKey.trim();

  // ── Idempotency: if this onboarding request was already processed, ──
  // ── return the existing school instead of creating a duplicate. ──
  const existingByKey = await db.collection(COL_SCHOOLS)
    .where('onboardingIdempotencyKey', '==', key)
    .limit(1)
    .get();
  if (!existingByKey.empty) {
    const existing = existingByKey.docs[0].data();
    return {
      schoolId: existing.schoolId,
      school: {
        schoolId: existing.schoolId,
        schoolName: existing.schoolName,
        status: existing.status || 'active',
        plan: existing.plan || 'trial',
      },
      adminEmail: existing.adminEmail || null,
      setupComplete: existing.setupComplete === true,
      alreadyOnboarded: true,
    };
  }

  // ── 1. Validate school + first-admin inputs. ──
  const data = validateSchoolData(schoolData);

  // ── 2. Prevent duplicate accounts / schools. ──
  //    The first-admin email must not already have a Firebase Auth account.
  try {
    await auth.getUserByEmail(data.adminEmail);
    throw new Error('A user with this admin email already exists.');
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }
  //    The school email (if provided) must not already be an account either.
  if (data.schoolEmail) {
    try {
      await auth.getUserByEmail(data.schoolEmail);
      throw new Error('A school with this email already exists.');
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }
  }

  // ── 3. Generate a unique server-side school ID. ──
  const schoolId = await nextAvailableSchoolId(db);
  const now = new Date().toISOString();

  // Rollback state, populated as resources are created.
  let authUid = null;
  const created = { schoolDoc: false, authUser: false, profile: false };

  try {
    // ── 4. Create the tenant root: schools/{schoolId}. ──
    //    Store the idempotency key on the school doc so repeat submissions
    //    resolve to this same school.
    await db.collection(COL_SCHOOLS).doc(schoolId).set({
      type:                   'school',
      schoolId,
      schoolName:             data.schoolName,
      schoolSlug:             slugify(data.schoolName),
      schoolEmail:            data.schoolEmail,
      schoolAddress:          data.schoolAddress,
      schoolPhone:            data.schoolPhone,
      academicYear:           data.academicYear,
      currentTerm:            data.currentTerm,
      plan:                   data.plan,
      status:                 'active',
      provisionedBy:          'self-service',
      provisionedAt:          now,
      updatedAt:              now,
      onboardingIdempotencyKey: key,
      adminEmail:             data.adminEmail,
      setupComplete:          false,
    });
    created.schoolDoc = true;

    // ── 5. Create the first administrator's Firebase Auth account. ──
    const authRecord = await auth.createUser({
      email:      data.adminEmail,
      password:   data.adminPassword,
      displayName: data.adminFullName,
      emailVerified: false,
    });
    authUid = authRecord.uid;
    created.authUser = true;

    // ── 6. Write the admin's Firestore profile (source of truth). ──
    const profile = {
      type:              'user',
      uid:               authUid,
      fullName:          data.adminFullName,
      email:             data.adminEmail,
      role:              ROLE_ADMIN,
      schoolId,
      schoolIds:         [schoolId],
      membershipActive:  { [schoolId]: true },
      active:            true,
      platformAdmin:     false,
      assignedClasses:   [],
      createdBy:         'self-service',
      createdAt:         now,
      updatedAt:         now,
    };
    await db.collection(COL_USERS).doc(authUid).set(profile);
    created.profile = true;

    // ── 7. Set Firebase Auth custom claims (runtime authority for rules). ──
    await auth.setCustomUserClaims(authUid, buildClaims(schoolId, ROLE_ADMIN, true, true, false));

    // ── 8. Create school-specific configuration (setup + app_config). ──
    await db.collection(COL_SCHOOLS).doc(schoolId).collection('config').doc(DOC_SETUP).set({
      type:          'setup',
      schoolId,
      setupComplete: true,
      createdBy:     'self-service',
      createdAt:     now,
      updatedAt:     now,
    });
    await db.collection(COL_SCHOOLS).doc(schoolId).collection('config').doc(DOC_APP_CFG).set({
      type:          'config',
      schoolId,
      schoolName:    data.schoolName,
      schoolMotto:   data.schoolMotto || '',
      schoolAddress: data.schoolAddress || '',
      schoolPhone:   data.schoolPhone || '',
      schoolEmail:   data.schoolEmail || '',
      academicYear:  data.academicYear,
      currentTerm:   data.currentTerm,
      createdAt:     now,
      updatedAt:     now,
    });
    // Mark the school doc as set up.
    await db.collection(COL_SCHOOLS).doc(schoolId).update({
      setupComplete: true,
      updatedAt:     now,
    });

    return {
      schoolId,
      school: {
        schoolId,
        schoolName: data.schoolName,
        status: 'active',
        plan: data.plan,
      },
      adminUserId: authUid,
      adminEmail: data.adminEmail,
      setupComplete: true,
      alreadyOnboarded: false,
    };
  } catch (e) {
    // ── Rollback: no partially provisioned accounts or orphaned tenants. ──
    await rollback({ db, auth, schoolId, authUid, created });
    throw e;
  }
}
