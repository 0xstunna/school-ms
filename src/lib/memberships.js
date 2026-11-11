/**
 * Shared membership helpers used by both client-side AuthContext and
 * server-side provisioning code.
 *
 * This module has NO Firebase dependencies — it is safe to import from
 * both browser/Electron client code and server-side Node.js code.
 */

/**
 * Build per-school membership entries from a user profile.
 * @returns {Array<{ schoolId, role, active }>}
 */
export function membershipsFromProfile(profile) {
  if (!profile) return [];
  const schoolIds        = profile.schoolIds || [];
  const roles            = profile.roles || {};
  const membershipActive = profile.membershipActive || {};
  return schoolIds.map((schoolId) => ({
    schoolId,
    role:   (roles[schoolId] || [profile.role || 'teacher'])[0],
    active: membershipActive[schoolId] !== false, // default true if unset
  }));
}
