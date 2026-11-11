import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  getIdToken,
} from 'firebase/auth';
import { auth } from '../db/firebase.js';
import { clearPersistence, resetPersistence } from '../db/firebase.js';
import {
  getUserByUid,
  updateUser,
  getUsers,
} from '../db/userService.js';
import { safeGet } from '../db/firebase.js';
import { membershipsFromProfile } from '../lib/memberships.js';
import { authErrorMessage } from '../lib/authErrors.js';

const COL_SCHOOLS = 'schools';

// Endpoint for the trusted server-side active-school switch (Cloud Function /
// HTTPS handler implemented in src/server/switchSchool.js). Configure via env;
// defaults to a relative route that must be mounted by the server host.
const SWITCH_SCHOOL_ENDPOINT =
  (import.meta.env?.VITE_SWITCH_SCHOOL_ENDPOINT && String(import.meta.env.VITE_SWITCH_SCHOOL_ENDPOINT)) ||
  '/api/switch-school';

const AuthContext = createContext(null);

/**
 * Derives per-school memberships from a user profile, marking each as active
 * or inactive. Suspended/closed schools are treated as inactive for switching.
 */
function resolveMemberships(profile) {
  const memberships = membershipsFromProfile(profile);
  return memberships.map((m) => ({
    ...m,
    // A school with no `schools/{schoolId}` doc, or one with status != 'active',
    // is not selectable as the active school.
    operational: true,
  }));
}

export const AuthProvider = ({ children }) => {
  const [user, setUser]          = useState(null);
  const [loading, setLoading]    = useState(true); // true until first auth check resolves
  const [activeSchool, setActiveSchoolState] = useState(null); // { schoolId, schoolName?, status? }

  useEffect(() => {
    // Firebase Auth persists session automatically across app restarts.
    // onAuthStateChanged fires immediately with the current auth state on mount.
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          await initializeUserSession(firebaseUser);
        } catch (err) {
          console.error('Failed to initialize user session:', err);
          setUser(null);
        }
      } else {
        setUser(null);
        setActiveSchoolState(null);
      }
      setLoading(false);
    });

    return unsubscribe; // Cleanup listener on unmount
  }, []);

  /**
   * Loads the Firestore profile, resolves the active school, and refreshes the
   * ID token so custom claims reflect the current active school.
   */
  async function initializeUserSession(firebaseUser) {
    const profile = await getUserByUid(firebaseUser.uid);
    if (!profile) {
      // Account exists in Firebase Auth but has no Firestore profile.
      await signOut(auth);
      setUser(null);
      return;
    }
    if (!profile.active) {
      // Account exists in Firebase Auth but has been deactivated in Firestore.
      await signOut(auth);
      setUser(null);
      return;
    }

    // Resolve the active school: prefer the profile's schoolId, otherwise
    // auto-select when there is exactly one authorised membership.
    const memberships = membershipsFromProfile(profile);
    let activeSchoolId = profile.schoolId || null;
    if (!activeSchoolId && memberships.length === 1) {
      activeSchoolId = memberships[0].schoolId;
    }
    if (activeSchoolId && !memberships.find((m) => m.schoolId === activeSchoolId)) {
      // Profile points at a school the user is not a member of — clear it.
      activeSchoolId = null;
    }

    // Refresh the ID token so custom claims (schoolId, roles, ...) are current.
    try {
      await getIdToken(firebaseUser, true);
    } catch (err) {
      console.warn('Could not refresh ID token:', err.message);
    }

    setUser(profile);
    if (activeSchoolId) {
      await loadActiveSchoolInfo(activeSchoolId);
    } else {
      setActiveSchoolState(null);
    }
  }

  /**
   * Reads schools/{schoolId} to surface the school's name and operational
   * status (suspended/closed schools are not selectable).
   */
  async function loadActiveSchoolInfo(schoolId) {
    try {
      const snap = await safeGet(COL_SCHOOLS, schoolId);
      setActiveSchoolState(snap
        ? { schoolId, schoolName: snap.schoolName || snap.data()?.schoolName, status: snap.data()?.status }
        : { schoolId, schoolName: null, status: null });
    } catch (err) {
      // School doc may not exist yet (transitional tenants). Treat as active.
      setActiveSchoolState({ schoolId, schoolName: null, status: null });
    }
  }

  // login: signs in via Firebase Auth, then immediately fetches the Firestore
  // profile so the caller gets a fully-populated user object.
  // Firebase Auth errors are translated to clear user-facing messages.
  const login = useCallback(async (email, password) => {
    let credential;
    try {
      credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      throw new Error(authErrorMessage(err));
    }
    await initializeUserSession(credential.user);
    return getUserSnapshot();
  }, []);

  function getUserSnapshot() {
    return user;
  }

  const logout = useCallback(async () => {
    // Sign out of Firebase Auth first so no session remains.
    await signOut(auth);
    // Clear offline persistence so no tenant data remains in the local cache
    // after sign-out. If clearing fails we still complete sign-out (auth is
    // independent of the cache) but surface the failure so the caller can
    // offer a recovery path (e.g. reload the page to clear the cache).
    let persistenceError = null;
    try {
      await resetPersistence();
    } catch (err) {
      persistenceError = err.message;
      console.error('Could not clear offline persistence on sign-out:', err.message);
    }
    setUser(null);
    setActiveSchoolState(null);
    return persistenceError;
  }, []);

  // Call this after an admin edits their own profile in Firestore
  const refreshUser = useCallback(async () => {
    if (!auth.currentUser) return;
    const profile = await getUserByUid(auth.currentUser.uid);
    if (profile) {
      setUser(profile);
      if (profile.schoolId) await loadActiveSchoolInfo(profile.schoolId);
    }
  }, []);

  /**
   * Switches the active school to an authorised membership.
   *
   * - Stops all live Firestore listeners (via terminate) before touching the
   *   cache, so no reads hit the previous school's data during the switch.
   * - Clears offline persistence fail-safe: records cached for the previous
   *   school CANNOT leak into the new school's workspace. If clearing fails,
   *   the switch aborts — we never silently proceed with a stale cache.
   * - Calls the trusted server-side active-school switch endpoint
   *   (src/server/switchSchool.js) which verifies the ID token, authorises
   *   membership in the destination school, verifies the school is operational,
   *   updates the profile, and re-issues custom claims. Clients never write
   *   their own claims.
   * - Refreshes the client ID token so the session carries the new active
   *   school for Firestore rule evaluation.
   *
   * Handles users with no active school membership gracefully: if the switch
   * fails or there are no authorised schools, activeSchool is set to null and
   * the caller can render a "no school" state.
   */
  const switchActiveSchool = useCallback(async (schoolId) => {
    if (!auth.currentUser) throw new Error('Not authenticated.');

    const currentProfile = user;
    if (!currentProfile) throw new Error('No user profile loaded.');

    // Fast local validation of membership before any server round-trip.
    const memberships = membershipsFromProfile(currentProfile);
    const target = memberships.find((m) => m.schoolId === schoolId);
    if (!target) {
      throw new Error('You are not a member of this school.');
    }
    if (target.active === false) {
      throw new Error('Your membership in this school is inactive.');
    }

    // 0. Stop all live listeners and clear offline persistence fail-safe.
    //    resetPersistence() terminates the Firestore instance (stopping every
    //    listener), deletes the IndexedDB cache, and reinitializes a fresh
    //    instance. Offline reads bypass security rules, so a stale cache is a
    //    real tenant-isolation risk — we never proceed silently on failure.
    try {
      await resetPersistence();
    } catch (err) {
      throw new Error(
        'Could not isolate offline cache before switching schools: ' + err.message +
        '. Sign out and reload the page to recover.',
      );
    }

    // 1. Call the trusted server-side active-school switch endpoint.
    //    The server verifies the ID token, authorises membership in the
    //    destination school, verifies the school is operational, updates the
    //    profile, and re-issues custom claims.
    let idToken;
    try {
      idToken = await getIdToken(auth.currentUser);
    } catch (err) {
      throw new Error('Could not obtain ID token for school switch: ' + err.message);
    }

    let switchResult;
    try {
      const resp = await fetch(SWITCH_SCHOOL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + idToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ schoolId }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        throw new Error(json.error || 'School switch rejected by server.');
      }
      switchResult = json;
    } catch (err) {
      // Recovery path: the cache has already been cleared, so the previous
      // school's data is no longer readable. Tell the caller to retry or
      // sign out and reload to restore a consistent session.
      throw new Error(
        'School switch failed: ' + err.message +
        '. The offline cache was cleared; sign out and reload to restore your previous school session.',
      );
    }

    // 2. Refresh the client ID token so custom claims reflect the new active
    //    school for Firestore rule evaluation.
    try {
      await getIdToken(auth.currentUser, true);
    } catch (err) {
      throw new Error('Could not refresh ID token after school switch: ' + err.message);
    }

    // 3. Reload the profile to pick up the updated schoolId and claims.
    const refreshed = await getUserByUid(auth.currentUser.uid);
    if (refreshed) {
      setUser(refreshed);
      await loadActiveSchoolInfo(switchResult.schoolId || schoolId);
    }
  }, [user]);

  // ── Role helpers — interpreted relative to the active school. ──────────────

  const activeRole = useCallback(() => {
    if (!user) return null;
    const memberships = membershipsFromProfile(user);
    const m = memberships.find((x) => x.schoolId === (user.schoolId || null));
    return m ? m.role : user.role || null;
  }, [user]);

  const hasRole  = useCallback((...roles) => !!user && roles.includes(activeRole()), [user, activeRole]);
  const isAdmin   = useCallback(() => hasRole('admin'), [hasRole]);
  const isTeacher = useCallback(() => hasRole('teacher'), [hasRole]);
  const isBursar  = useCallback(() => hasRole('bursar'), [hasRole]);
  const isPlatformAdmin = useCallback(() => !!user && user.platformAdmin === true, [user]);

  const schoolMemberships = useMemo(() => {
    if (!user) return [];
    return membershipsFromProfile(user);
  }, [user]);

  const authorisedSchools = useMemo(() => {
    if (!user) return [];
    return schoolMemberships.filter((m) => m.active !== false);
  }, [schoolMemberships]);

  const canSwitchTo = useCallback((schoolId) => {
    if (!user) return false;
    return authorisedSchools.some((m) => m.schoolId === schoolId);
  }, [authorisedSchools]);

  const hasNoActiveSchool = useCallback(() => {
    return !!user && !user.schoolId && authorisedSchools.length === 0;
  }, [user, authorisedSchools]);

  const activeSchoolId = useMemo(() => (user ? user.schoolId : null), [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        activeSchool,
        activeSchoolId,
        schoolMemberships,
        authorisedSchools,
        activeRole,
        hasRole,
        isAdmin,
        isTeacher,
        isBursar,
        isPlatformAdmin,
        canSwitchTo,
        hasNoActiveSchool,
        switchActiveSchool,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export default AuthContext;
