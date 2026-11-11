/**
 * SERVER-ONLY — Active-school switching for multi-tenant sessions.
 *
 * `switchActiveSchool(idToken, schoolId)` is the trusted server-side mechanism
 * for changing a user's active school. It is intended to be invoked from a
 * Cloud Function / HTTPS endpoint (or CLI) that receives a Firebase ID token
 * from the client. The client can NEVER write its own custom claims.
 *
 * Flow:
 *   1. Verify the client Firebase ID token on the server (Admin SDK).
 *   2. Load the caller's users/{uid} profile (source of truth for memberships).
 *   3. Authorize: the caller must have an ACTIVE membership in the destination
 *      school; the destination school must be operational (status 'active').
 *   4. Update the profile's active school (schoolId) server-side.
 *   5. Re-issue Firebase Auth custom claims for the new active school.
 *   6. Return the claims so the client can refresh its ID token
 *      (getIdToken(true)) and continue with tenant-isolated reads.
 *
 * Revoked memberships and suspended schools are rejected. Platform-administrator
 * separation is preserved: a platform administrator switching their own active
 * school is subject to the same membership checks (they are not automatically a
 * member of every school).
 *
 * No Admin SDK operation is exposed to the frontend — this module is imported
 * only by server-side code.
 */

import { getAdminAuth, getAdminDb } from './admin.js';

const COL_SCHOOLS = 'schools';
const COL_USERS   = 'users';

/**
 * Verifies a Firebase ID token and switches the caller's active school.
 *
 * @param {string} idToken — Firebase ID token from the client.
 * @param {string} schoolId — school to make active.
 * @param {object} [deps] — injected Admin SDK services (defaults to the
 *   server Admin SDK). Used by tests; production passes nothing.
 * @param {object} [deps.auth] — Admin Auth instance.
 * @param {object} [deps.db] — Admin Firestore instance.
 * @returns {Promise<{ uid, schoolId, claims, profile }>}
 */
export async function switchActiveSchool(idToken, schoolId, deps = {}) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('idToken is required.');
  }
  if (!schoolId || typeof schoolId !== 'string') {
    throw new Error('schoolId is required.');
  }

  const auth = deps.auth || getAdminAuth();
  const db   = deps.db   || getAdminDb();

  // ── 1. Verify the Firebase ID token on the server. ──
  //    This cryptographically binds the request to a real, authenticated user.
  //    Clients cannot forge this token.
  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch (e) {
    throw new Error('Invalid or expired ID token: ' + e.message);
  }
  const uid = decoded.uid;

  // ── 2. Load the caller's profile (source of truth for memberships). ──
  const profileSnap = await db.collection(COL_USERS).doc(uid).get();
  if (!profileSnap.exists) {
    throw new Error('User profile not found.');
  }
  const profile = profileSnap.data();

  // Globally deactivated accounts may not switch schools.
  if (profile.active === false) {
    throw new Error('Account is deactivated.');
  }

  // ── 3. Authorize membership in the destination school. ──
  const schoolIds = profile.schoolIds || [];
  if (!schoolIds.includes(schoolId)) {
    throw new Error('You are not a member of this school.');
  }

  const membershipActive = profile.membershipActive || {};
  if (membershipActive[schoolId] === false) {
    throw new Error('Your membership in this school is inactive.');
  }

  // ── 4. Verify the destination school is operational. ──
  const schoolSnap = await db.collection(COL_SCHOOLS).doc(schoolId).get();
  if (schoolSnap.exists) {
    const schoolStatus = schoolSnap.data()?.status;
    if (schoolStatus && schoolStatus !== 'active') {
      throw new Error('School is ' + schoolStatus + ' and cannot be selected.');
    }
  }

  // ── 5. Update the profile's active school (server-side, trusted). ──
  const now = new Date().toISOString();
  await db.collection(COL_USERS).doc(uid).update({
    schoolId,
    updatedAt: now,
  });

  // ── 6. Re-issue custom claims for the new active school. ──
  //    Claims stay small: only the active school + its role + global flags.
  //    Per-school memberships/roles remain on the users/{uid} profile.
  const roles = profile.roles || {};
  const targetRole = (roles[schoolId] || [profile.role || 'teacher'])[0];
  const claims = {
    schoolId,
    role: targetRole,
    am: membershipActive[schoolId] !== false,
    active: profile.active !== false,
    platformAdmin: profile.platformAdmin === true,
  };

  await auth.setCustomUserClaims(uid, claims);

  const refreshedProfile = { ...profile, schoolId };

  return {
    uid,
    schoolId,
    claims,
    profile: refreshedProfile,
  };
}

/**
 * Framework-agnostic HTTP request handler wrapper for switchActiveSchool.
 *
 * Reads `Authorization: Bearer <idToken>` and a JSON body `{ schoolId }`.
 * Responds with `{ uid, schoolId, claims, profile }` on success, or an error
 * JSON with the appropriate HTTP status.
 *
 * Usage (Cloud Function):
 *   exports.switchActiveSchool = functions.https.onRequest((req, res) =>
 *     switchSchoolHandler(req, res));
 *
 * @param {object} req — Node-style request (headers, body).
 * @param {object} res — Node-style response (status, json, send).
 */
export async function switchSchoolHandler(req, res) {
  try {
    const authHeader = req.headers && req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header.' });
      return;
    }
    const idToken = authHeader.slice(7).trim();

    const body = req.body || {};
    const schoolId = body.schoolId;

    const result = await switchActiveSchool(idToken, schoolId);

    res.status(200).json({
      ok: true,
      uid: result.uid,
      schoolId: result.schoolId,
      claims: result.claims,
      profile: result.profile,
    });
  } catch (e) {
    const status = /Invalid or expired/.test(e.message) ? 401 : 403;
    res.status(status).json({ ok: false, error: e.message });
  }
}
