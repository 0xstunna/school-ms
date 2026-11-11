import { initializeApp }    from 'firebase/app';
import { getAuth }          from 'firebase/auth';
import { getStorage }       from 'firebase/storage';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  clearIndexedDbPersistence,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
} from 'firebase/firestore';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG  —  paste your Firebase project values here (or use .env)
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            (import.meta.env?.VITE_FIREBASE_API_KEY) || '',
  authDomain:        (import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN) || '',
  projectId:         (import.meta.env?.VITE_FIREBASE_PROJECT_ID) || '',
  storageBucket:     (import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET) || '',
  messagingSenderId: (import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID) || '',
  appId:             (import.meta.env?.VITE_FIREBASE_APP_ID) || '',
};

// Firebase is only initialized when a valid config is present (built app with
// .env). In plain Node (tests, scripts) without .env, exports are null and
// helper functions throw a clear error if called without Firebase.
const hasConfig = Boolean(
  import.meta.env?.VITE_FIREBASE_API_KEY &&
  import.meta.env?.VITE_FIREBASE_PROJECT_ID
);

let appInstance;
let authInstance;
let storageInstance;
let dbInstance;

if (hasConfig) {
  appInstance = initializeApp(firebaseConfig);
  authInstance = getAuth(appInstance);
  storageInstance = getStorage(appInstance);
  dbInstance = initializeFirestore(appInstance, {
    localCache: persistentLocalCache({
      tabManager: persistentSingleTabManager(),
    }),
  });
}

export const auth      = authInstance;
export const storage   = storageInstance;
export const appConfig = firebaseConfig; // re-exported for secondary app instances
export const db        = dbInstance;

function requireDb() {
  if (!db) throw new Error('Firebase not initialized — missing VITE_FIREBASE config. Check .env file.');
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export const generateId = (prefix) => {
  const ts  = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}_${ts}_${rnd}`;
};

// Returns all documents in a collection as plain objects with an `id` field.
export const getAllDocs = async (col) => {
  requireDb();
  const snap = await getDocs(collection(db, col));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// Returns a single document or null if it does not exist.
export const safeGet = async (col, id) => {
  requireDb();
  const snap = await getDoc(doc(db, col, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// Creates or fully replaces a document.
// ⚠️  Does NOT inject timestamps — each service sets its own timestamps
//     so the data shape stays predictable and consistent.
export const setDocument = async (col, id, data) => {
  requireDb();
  await setDoc(doc(db, col, id), data);
  return { id, ...data };
};

// Creates a document with an auto-generated Firestore ID.
export const addDocument = async (col, data) => {
  requireDb();
  const ref = await addDoc(collection(db, col), data);
  return { id: ref.id, ...data };
};

// Merges updates into an existing document.
// ⚠️  Does NOT inject updatedAt — callers set this themselves.
export const updateDocument = async (col, id, updates) => {
  requireDb();
  await updateDoc(doc(db, col, id), updates);
};

// Permanently deletes a document.
export const deleteDocument = async (col, id) => {
  requireDb();
  await deleteDoc(doc(db, col, id));
};

/**
 * Terminates the current Firestore instance, clears the offline persistence
 * (IndexedDB cache), and reinitializes Firestore on the same Firebase app.
 *
 * This is the fail-safe path used when switching schools (and on sign-out) so
 * that records cached while using one school cannot become visible in another
 * school's workspace. Offline reads are served from IndexedDB WITHOUT being
 * re-evaluated against Firestore security rules, so a stale cache is a real
 * tenant-isolation risk: it MUST be cleared, not merely logged.
 *
 * Steps:
 *   1. Terminate the Firestore instance (stops all listeners, releases the
 *      IndexedDB lock).
 *   2. Clear IndexedDB persistence (deletes the cached documents).
 *   3. Reinitialize a fresh Firestore instance so reads/writes continue to work
 *      for the newly active school.
 *
 * This function THROWS if any step fails. Callers must not silently proceed
 * with a potentially-stale cache. On failure, the caller should present a
 * recovery path (for example: sign out and reload, or retry).
 *
 * Safe to call multiple times. If Firebase is not initialized, throws.
 *
 * @returns {Promise<{ terminated: boolean, cleared: boolean }>}
 */
/**
 * Terminates the current Firestore instance, clears the offline persistence
 * (IndexedDB cache), and reinitializes Firestore on the same Firebase app.
 *
 * @param {object} [injectedDb] — Firestore instance to operate on. Defaults to
 *   the module-level `db`. Provided for testing; when given, the module-level
 *   `db` is NOT overwritten (so tests can use a mock without side effects).
 * @returns {Promise<{ terminated: boolean, cleared: boolean }>}
 */
export const resetPersistence = async (injectedDb = null) => {
  const targetDb = injectedDb || db;
  if (!targetDb) {
    throw new Error('Firestore is not initialized — cannot reset persistence (missing Firebase config).');
  }

  // ── 1. Terminate the Firestore instance. ──
  //    This stops every live listener and releases the IndexedDB lock so the
  //    cache can be deleted. Without this, clearIndexedDbPersistence throws
  //    "persistence already started".
  let terminated = false;
  try {
    await targetDb.terminate();
    terminated = true;
  } catch (e) {
    throw new Error('Failed to terminate Firestore instance: ' + e.message);
  }

  // ── 2. Clear IndexedDB persistence. ──
  //    Perform this on the terminated instance (the lock is released). Delete
  //    the cached documents so no record from the previous school survives.
  let cleared = false;
  try {
    await clearIndexedDbPersistence(targetDb);
    cleared = true;
  } catch (e) {
    const msg = String(e);
    // A "persistence not started" / "already cleared" condition is not an error.
    if (!/persist.*not.*started|already|not active|unavailable/i.test(msg)) {
      throw new Error('Failed to clear IndexedDB persistence: ' + e.message);
    }
    cleared = true;
  }

  // ── 3. Reinitialize Firestore on the same Firebase app. ──
  //    The app instance (and Auth session) survives; only the Firestore client
  //    is recreated with a fresh, empty cache. terminate() detaches the old
  //    Firestore instance from the app, so initializeFirestore can create a new
  //    one. If the instance was not detached, fall back to getFirestore.
  if (!injectedDb) {
    try {
      dbInstance = initializeFirestore(appInstance, {
        localCache: persistentLocalCache({
          tabManager: persistentSingleTabManager(),
        }),
      });
    } catch (e) {
      try {
        dbInstance = getFirestore(appInstance);
      } catch (e2) {
        throw new Error(
          'Failed to reinitialize Firestore after clearing persistence: ' + e.message +
          ' (fallback also failed: ' + e2.message + ')',
        );
      }
    }
    db = dbInstance;
  }

  return { terminated, cleared };
};

/**
 * Backward-compatible wrapper kept for call sites that still reference
 * `clearPersistence`. It delegates to `resetPersistence` but logs a warning
 * instead of throwing, preserving the previous "best-effort" behaviour for
 * non-switch paths (e.g. sign-out) while switchActiveSchool uses the strict
 * resetPersistence directly.
 *
 * @deprecated Use resetPersistence() for school switching; it throws on failure.
 */
export const clearPersistence = async () => {
  if (!db) return; // Firebase not initialized — nothing to clear
  try {
    await resetPersistence();
  } catch (e) {
    console.warn('[firebase] Could not clear offline persistence:', e.message);
  }
};

// Re-export Firestore primitives for services that need them directly.
export { collection, doc, query, where, orderBy, getDocs };
