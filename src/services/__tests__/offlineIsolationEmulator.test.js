/**
 * OFFLINE TENANT ISOLATION — INDEXEDDB LIFECYCLE SEQUENCE (Task 5)
 *
 * Verifies the resetPersistence() sequence (terminate -> clearIndexedDbPersistence
 * -> initializeFirestore) against the Firebase Emulator Suite using the real
 * firebase client SDK.
 *
 * NOTE: Node.js has no IndexedDB, so Firestore falls back to memory cache and
 * reads still reach the emulator server. True stale-cache isolation therefore
 * requires a browser (Electron/web). What we CAN verify here:
 *   - terminate() + clearIndexedDbPersistence() + reinitialisation completes
 *     without error (a fresh instance works after a switch).
 *   - clearIndexedDbPersistence() on a LIVE instance throws — a switch must
 *     abort rather than proceed with a potentially-stale cache.
 *   - The full sign-out sequence (signOut -> terminate -> clear -> reinit)
 *     completes cleanly.
 *
 * Prerequisites: both emulators must be running:
 *   npx firebase emulators:start --only auth,firestore --project demo-alama
 *
 * Run: node src/services/__tests__/offlineIsolationEmulator.test.js
 */

import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentSingleTabManager,
  initializeFirestore,
  clearIndexedDbPersistence,
  doc,
  setDoc,
  getDoc,
  terminate,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-alama';
const APP_NAME = 'alama_offline_test';

let appCounter = 0;
let passed = 0;
let failed = 0;

function test(name, fn) {
  return async () => {
    try {
      await fn();
      passed += 1;
      console.log(`  PASS: ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`  FAIL: ${name} — ${e.message}`);
    }
  };
}

async function expectFails(maybePromiseOrFn, expectedMessage) {
  const run = typeof maybePromiseOrFn === 'function' ? maybePromiseOrFn : () => maybePromiseOrFn;
  try {
    await run();
    throw new Error('Expected promise to reject but it resolved.');
  } catch (e) {
    if (expectedMessage && !String(e.message).toLowerCase().includes(expectedMessage.toLowerCase())) {
      throw new Error(`Expected error to include "${expectedMessage}" but got "${e.message}".`);
    }
  }
}

function createFirestoreApp() {
  appCounter += 1;
  const app = initializeApp(
    {
      apiKey: 'demo',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    },
    `${APP_NAME}_${appCounter}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099');
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
  });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return { app, auth, db };
}

async function deleteAppAndDb(app, db) {
  try {
    await terminate(db);
  } catch (e) {
    // ignore
  }
  try {
    await deleteApp(app);
  } catch (e) {
    // ignore
  }
}

async function seedEnvironment(auth, db, schoolId) {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await createUserWithEmailAndPassword(auth, `offline_${suffix}@example.com`, 'Password123');
  await setDoc(doc(db, 'users', auth.currentUser.uid), {
    type: 'user', uid: auth.currentUser.uid, schoolId,
    membershipActive: { [schoolId]: true }, active: true, platformAdmin: false,
  });
  await setDoc(doc(db, 'schools', schoolId), {
    type: 'school', schoolId, schoolName: 'School ' + schoolId.slice(-1), status: 'active',
  });
  return auth.currentUser;
}

// ── Tests ─────────────────────────────────────────────────────────────────

const tests = [
  test('terminate + clear + reinit completes (fresh instance works)', async () => {
    const { app: appA, auth: authA, db: dbA } = createFirestoreApp();
    await seedEnvironment(authA, dbA, 'sch_A');
    await setDoc(doc(dbA, 'students', 'stuA1'), {
      type: 'student', schoolId: 'sch_A', fullName: 'A Student',
      admissionNumber: 'ADM001', status: 'active',
    });

    // Full school-switch sequence: terminate, clear, reinit via new instance.
    await terminate(dbA);
    await clearIndexedDbPersistence(dbA);
    const { app: appB, auth: authB, db: dbB } = createFirestoreApp();
    await seedEnvironment(authB, dbB, 'sch_B');

    // Fresh instance reads/writes its own school's data.
    const snapB = await getDoc(doc(dbB, 'students', 'stuB1'));
    // stuB1 doesn't exist yet; just confirm the instance is operational.
    await setDoc(doc(dbB, 'students', 'stuB1'), {
      type: 'student', schoolId: 'sch_B', fullName: 'B Student',
      admissionNumber: 'ADM002', status: 'active',
    });
    const snapB2 = await getDoc(doc(dbB, 'students', 'stuB1'));
    if (!snapB2.exists() || snapB2.data().schoolId !== 'sch_B') {
      throw new Error('fresh instance should read/write school B data.');
    }

    await deleteAppAndDb(appA, dbA);
    await deleteAppAndDb(appB, dbB);
  }),

  test('clearing persistence on a live instance throws (switch must abort)', async () => {
    const { app: appA, auth: authA, db: dbA } = createFirestoreApp();
    await seedEnvironment(authA, dbA, 'sch_A');

    // clearIndexedDbPersistence without terminate first must throw — this is
    // the abort behaviour: a switch must never silently proceed with a live
    // cache.
    await expectFails(() => clearIndexedDbPersistence(dbA), 'Persistence can only be cleared');

    // Confirm dbA is still the live, usable instance (no silent proceed).
    const snap = await getDoc(doc(dbA, 'schools', 'sch_A'));
    if (!snap.exists()) throw new Error('dbA must remain usable after a blocked clear.');
    if (snap.data().schoolId !== 'sch_A') throw new Error('dbA should still target sch_A.');

    await deleteAppAndDb(appA, dbA);
  }),

  test('sign-out sequence: signOut + terminate + clear + reinit completes', async () => {
    const { app: appA, auth: authA, db: dbA } = createFirestoreApp();
    await seedEnvironment(authA, dbA, 'sch_A');
    await setDoc(doc(dbA, 'students', 'stuA1'), {
      type: 'student', schoolId: 'sch_A', fullName: 'A Student',
      admissionNumber: 'ADM001', status: 'active',
    });

    // Simulate logout: sign out of Auth, then clear persistence.
    await signOut(authA);
    await terminate(dbA);
    await clearIndexedDbPersistence(dbA);

    // Fresh instance for a new session.
    const { app: appB, auth: authB, db: dbB } = createFirestoreApp();
    await setDoc(doc(dbB, 'students', 'stuB1'), {
      type: 'student', schoolId: 'sch_B', fullName: 'B Student',
      admissionNumber: 'ADM002', status: 'active',
    });
    const snapB = await getDoc(doc(dbB, 'students', 'stuB1'));
    if (!snapB.exists()) throw new Error('new session should be able to write data.');

    await deleteAppAndDb(appA, dbA);
    await deleteAppAndDb(appB, dbB);
  }),

];

console.log('\nOffline Tenant Isolation — IndexedDB Lifecycle Sequence (Emulator)\n======================================================================\n');
console.log('Using emulators: Firestore 127.0.0.1:8080, Auth 127.0.0.1:9099\n');
console.log('Note: Node has no IndexedDB; reads reach the emulator server. Cache-isolation\n');
console.log('verification requires a browser (Electron/web) with persistentLocalCache.\n');

try {
  for (const t of tests) await t();
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
