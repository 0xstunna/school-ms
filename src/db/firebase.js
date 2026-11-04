import { initializeApp }    from 'firebase/app';
import { getAuth }          from 'firebase/auth';
import { getStorage }       from 'firebase/storage';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
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

// Re-export Firestore primitives for services that need them directly.
export { collection, doc, query, where, orderBy };
