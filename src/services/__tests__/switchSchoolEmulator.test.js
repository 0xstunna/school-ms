/**
 * SWITCH SCHOOL — REAL INTEGRATION TEST (Task 4)
 *
 * Exercises the complete, real school-switching flow against the Firebase
 * Emulator Suite (Firestore + Auth), NOT against production:
 *
 *   1. Create users in the Auth emulator (client SDK sign-up).
 *   2. Seed user profiles + school docs in Firestore (Admin SDK).
 *   3. Sign in via client SDK to obtain a real Firebase ID token.
 *   4. Call switchActiveSchool(idToken, schoolId) with the real ID token —
 *      the Admin SDK verifies it against the Auth emulator.
 *   5. Verify the profile is updated and small claims are re-issued.
 *   6. Verify rejected switches: inactive membership, suspended school,
 *      non-member school.
 *
 * Prerequisites: both emulators must be running:
 *   npx firebase emulators:start --only auth,firestore --project demo-alama
 *   (Firestore 127.0.0.1:8080, Auth 127.0.0.1:9099)
 *
 * Run: node src/services/__tests__/switchSchoolEmulator.test.js
 */

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIREBASE_PROJECT_ID = 'demo-alama';

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  getIdToken,
  updateProfile,
  deleteUser as clientDeleteUser,
} from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { initAdminApp, getAdminAuth, getAdminDb } from '../../server/admin.js';
import { switchActiveSchool } from '../../server/switchSchool.js';

// Initialize the Admin SDK explicitly against the emulator project so
// verifyIdToken can resolve the audience (project ID).
initAdminApp({ projectId: 'demo-alama' });

const COL_SCHOOLS = 'schools';
const COL_USERS = 'users';

// Unique suffix so re-runs don't collide with users left in the emulator.
const UNIQUE = Date.now().toString(36);

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

async function expectFails(promise, expectedMessage) {
  try {
    await promise;
    throw new Error('Expected promise to reject but it resolved.');
  } catch (e) {
    if (expectedMessage && !String(e.message).includes(expectedMessage)) {
      throw new Error(`Expected error to include "${expectedMessage}" but got "${e.message}".`);
    }
  }
}

// ── Clients connected to the emulator ─────────────────────────────────────

const clientConfig = {
  apiKey: 'demo',
  authDomain: 'demo-alama.firebaseapp.com',
  projectId: 'demo-alama',
};

const clientApp = initializeApp(clientConfig, 'alama_emulator_test');
const clientAuth = getAuth(clientApp);
connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099');
const clientDb = getFirestore(clientApp);
connectFirestoreEmulator(clientDb, '127.0.0.1', 8080);

const adminAuth = getAdminAuth();
const adminDb = getAdminDb();

// ── Helpers ───────────────────────────────────────────────────────────────

async function createEmulatedUser(email, password, displayName) {
  const credential = await createUserWithEmailAndPassword(clientAuth, email, password);
  await updateProfile(credential.user, { displayName });
  return credential.user;
}

async function signInAndGetIdToken(email, password) {
  const credential = await signInWithEmailAndPassword(clientAuth, email, password);
  return await getIdToken(credential.user);
}

async function seedProfileAndSchool(uid, email, profileOverrides, schoolOverrides) {
  const profile = {
    type: 'user',
    uid,
    fullName: profileOverrides.fullName || 'Test User',
    email,
    role: profileOverrides.role || 'admin',
    schoolId: profileOverrides.schoolId || 'sch_A',
    schoolIds: profileOverrides.schoolIds || ['sch_A', 'sch_B'],
    membershipActive: profileOverrides.membershipActive || { sch_A: true, sch_B: true },
    active: profileOverrides.active !== false,
    platformAdmin: profileOverrides.platformAdmin || false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await setDoc(doc(clientDb, COL_USERS, uid), profile);

  const schoolId = profile.schoolId;
  await setDoc(doc(clientDb, COL_SCHOOLS, schoolId), {
    type: 'school',
    schoolId,
    schoolName: (schoolOverrides && schoolOverrides.schoolName) || 'School A',
    status: (schoolOverrides && schoolOverrides.status) || 'active',
    updatedAt: new Date().toISOString(),
  });
  // Seed the second school too (sch_B) so multi-school switching works.
  await setDoc(doc(clientDb, COL_SCHOOLS, 'sch_B'), {
    type: 'school',
    schoolId: 'sch_B',
    schoolName: 'School B',
    status: 'active',
    updatedAt: new Date().toISOString(),
  });
  return profile;
}

async function cleanupEmulatedUser(uid) {
  try {
    await adminAuth.deleteUser(uid);
  } catch (e) {
    // ignore
  }
  try {
    await deleteDoc(doc(clientDb, COL_USERS, uid));
  } catch (e) {
    // ignore
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

const tests = [
  test('real switch: signs in, gets ID token, server verifies + switches school', async () => {
    const user = await createEmulatedUser(`alice_${UNIQUE}@scha.example.com`, 'Password123', 'Alice Admin');
    await seedProfileAndSchool(user.uid, user.email, {
      fullName: 'Alice Admin', role: 'admin', schoolId: 'sch_A',
      schoolIds: ['sch_A', 'sch_B'],
      membershipActive: { sch_A: true, sch_B: true },
    });

    const idToken = await signInAndGetIdToken(`alice_${UNIQUE}@scha.example.com`, 'Password123');

    // Switch from sch_A to sch_B (her second membership, teacher role there).
    const profileB = {
      ...(await (() => {
        // Reload the profile with sch_B as active role for this test.
        return { role: 'teacher', schoolId: 'sch_A', schoolIds: ['sch_A', 'sch_B'],
          membershipActive: { sch_A: true, sch_B: true } };
      })()),
    };
    // Override the seeded profile so sch_B shows teacher role.
    await setDoc(doc(clientDb, COL_USERS, user.uid), {
      type: 'user', uid: user.uid, fullName: 'Alice Admin', email: user.email,
      role: 'admin', schoolId: 'sch_A', schoolIds: ['sch_A', 'sch_B'],
      membershipActive: { sch_A: true, sch_B: true },
      active: true, platformAdmin: false,
      roles: { sch_A: ['admin'], sch_B: ['teacher'] },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    const result = await switchActiveSchool(idToken, 'sch_B', {
      auth: adminAuth,
      db: adminDb,
    });

    if (result.uid !== user.uid) throw new Error('uid mismatch.');
    if (result.schoolId !== 'sch_B') throw new Error('schoolId should be sch_B.');
    if (!result.claims) throw new Error('claims should be returned.');
    if (result.claims.schoolId !== 'sch_B') throw new Error('claims.schoolId should be sch_B.');
    if (result.claims.role !== 'teacher') throw new Error('claims.role should reflect sch_B role (teacher).');
    if (result.claims.am !== true) throw new Error('claims.am should be true.');
    if (result.claims.platformAdmin !== false) throw new Error('claims.platformAdmin should be false.');

    // Claims must stay small.
    if (result.claims.schoolIds !== undefined) throw new Error('claims must not include schoolIds.');
    if (result.claims.roles !== undefined) throw new Error('claims must not include roles.');
    const bytes = Buffer.byteLength(JSON.stringify(result.claims), 'utf8');
    if (bytes >= 1000) throw new Error(`Claims too large: ${bytes} bytes.`);

    // Profile updated server-side (schoolId now sch_B).
    const snap = await adminDb.collection(COL_USERS).doc(user.uid).get();
    const updated = snap.data();
    if (updated.schoolId !== 'sch_B') throw new Error('Profile schoolId should be updated to sch_B server-side.');

    await cleanupEmulatedUser(user.uid);
  }),

  test('real switch: rejected when membership is inactive', async () => {
    const user = await createEmulatedUser(`dave_${UNIQUE}@scha.example.com`, 'Password123', 'Dave Inactive');
    await setDoc(doc(clientDb, COL_USERS, user.uid), {
      type: 'user', uid: user.uid, fullName: 'Dave Inactive', email: user.email,
      role: 'admin', schoolId: 'sch_A', schoolIds: ['sch_A', 'sch_B'],
      membershipActive: { sch_A: true, sch_B: false },
      active: true, platformAdmin: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await setDoc(doc(clientDb, COL_SCHOOLS, 'sch_B'), {
      type: 'school', schoolId: 'sch_B', schoolName: 'School B', status: 'active',
      updatedAt: new Date().toISOString(),
    });

    const idToken = await signInAndGetIdToken(`dave_${UNIQUE}@scha.example.com`, 'Password123');
    await expectFails(
      switchActiveSchool(idToken, 'sch_B', { auth: adminAuth, db: adminDb }),
      'membership in this school is inactive',
    );
    await cleanupEmulatedUser(user.uid);
  }),

  test('real switch: rejected when school is suspended', async () => {
    const user = await createEmulatedUser(`fred_${UNIQUE}@scha.example.com`, 'Password123', 'Fred Suspended');
    await setDoc(doc(clientDb, COL_USERS, user.uid), {
      type: 'user', uid: user.uid, fullName: 'Fred Suspended', email: user.email,
      role: 'admin', schoolId: 'sch_A', schoolIds: ['sch_A', 'sch_suspended'],
      membershipActive: { sch_A: true, sch_suspended: true },
      active: true, platformAdmin: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await setDoc(doc(clientDb, COL_SCHOOLS, 'sch_suspended'), {
      type: 'school', schoolId: 'sch_suspended', schoolName: 'Suspended School',
      status: 'suspended', updatedAt: new Date().toISOString(),
    });

    const idToken = await signInAndGetIdToken(`fred_${UNIQUE}@scha.example.com`, 'Password123');
    await expectFails(
      switchActiveSchool(idToken, 'sch_suspended', { auth: adminAuth, db: adminDb }),
      'suspended',
    );
    await cleanupEmulatedUser(user.uid);
  }),

  test('real switch: rejected when user is not a member of the school', async () => {
    const user = await createEmulatedUser(`mallory_${UNIQUE}@scha.example.com`, 'Password123', 'Mallory');
    await setDoc(doc(clientDb, COL_USERS, user.uid), {
      type: 'user', uid: user.uid, fullName: 'Mallory', email: user.email,
      role: 'admin', schoolId: 'sch_A', schoolIds: ['sch_A'],
      membershipActive: { sch_A: true },
      active: true, platformAdmin: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    const idToken = await signInAndGetIdToken(`mallory_${UNIQUE}@scha.example.com`, 'Password123');
    await expectFails(
      switchActiveSchool(idToken, 'sch_Z', { auth: adminAuth, db: adminDb }),
      'not a member of this school',
    );
    await cleanupEmulatedUser(user.uid);
  }),

  test('real switch: rejected with an invalid ID token', async () => {
    await expectFails(
      switchActiveSchool('not-a-real-id-token', 'sch_A', { auth: adminAuth, db: adminDb }),
      'Invalid or expired ID token',
    );
  }),
];

console.log('\nSwitch School — Real Emulator Integration Tests\n=================================================\n');
console.log('Using emulators: Firestore 127.0.0.1:8080, Auth 127.0.0.1:9099\n');

try {
  for (const t of tests) await t();
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
