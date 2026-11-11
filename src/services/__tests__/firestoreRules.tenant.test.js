/**
 * Firestore security rules — multi-tenant isolation tests
 * ========================================================
 *
 * These tests run against the Firebase Emulator and do NOT require production
 * credentials or write to a real Firebase project.
 *
 * Prerequisite: the Firestore emulator must be running on 127.0.0.1:8080.
 *   npx firebase emulators:start --only firestore --project demo-alama
 *
 * Run:
 *   node src/services/__tests__/firestoreRules.tenant.test.js
 */

import fs from 'fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'demo-alama';
const RULES = fs.readFileSync('firestore.rules', 'utf8');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Claim fixtures (mirror the custom-claim shape from TENANT_IDENTITY_MODEL.md)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const claims = (uid, overrides = {}) => ({
  sub: uid,
  user_id: uid,
  schoolId: 'sch_A',
  role: 'admin',
  am: true,
  active: true,
  platformAdmin: false,
  ...overrides,
});

const alice = () => claims('alice');            // sch_A admin
const bob   = () => claims('bob', {              // sch_A teacher
  role: 'teacher',
});
const carol = () => claims('carol', {            // sch_B admin
  schoolId: 'sch_B',
  role: 'admin',
  am: true,
});
const dave  = () => claims('dave', {             // sch_A admin, INACTIVE membership
  am: false,
});
const eve   = () => claims('eve', {              // platform admin
  platformAdmin: true,
  am: true,
});
const fred  = () => claims('fred', {             // member of suspended school
  schoolId: 'sch_suspended',
  role: 'admin',
  am: true,
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });

  const as = (claimsFn) => {
    const c = claimsFn();
    // authenticatedContext(authUid, claims) — request.auth.uid must match the
    // profile document id used by isMemberOfSchool (users/$(request.auth.uid)).
    return testEnv.authenticatedContext(c.sub || c.user_id, c);
  };

  // Seed tenant/school docs and student records bypassing rules (owner token).
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.collection('schools').doc('sch_A').set({
      type: 'school', schoolId: 'sch_A', schoolName: 'School A', status: 'active',
    });
    await db.collection('schools').doc('sch_B').set({
      type: 'school', schoolId: 'sch_B', schoolName: 'School B', status: 'active',
    });
    await db.collection('schools').doc('sch_suspended').set({
      type: 'school', schoolId: 'sch_suspended', schoolName: 'Suspended School', status: 'suspended',
    });
    await db.collection('students').doc('sA1').set({
      type: 'student', schoolId: 'sch_A', fullName: 'A Student One',
      admissionNumber: 'ADM0001', status: 'active',
    });
    await db.collection('students').doc('sA2').set({
      type: 'student', schoolId: 'sch_A', fullName: 'A Student Two',
      admissionNumber: 'ADM0002', status: 'active',
    });
    await db.collection('students').doc('sB1').set({
      type: 'student', schoolId: 'sch_B', fullName: 'B Student One',
      admissionNumber: 'ADM0101', status: 'active',
    });
    // Seed exam records for cross-school tests.
    await db.collection('exams').doc('eA1').set({
      type: 'exam', schoolId: 'sch_A', name: 'Math CAT 1',
      classLevel: 'S1', classStream: 'all', subjectId: 'm1',
      academicYear: '2026', term: 'Term 1', outOf: 100,
    });
    await db.collection('exams').doc('eB1').set({
      type: 'exam', schoolId: 'sch_B', name: 'Math CAT 1',
      classLevel: 'S1', classStream: 'all', subjectId: 'm1',
      academicYear: '2026', term: 'Term 1', outOf: 100,
    });
    // Seed exam_result records for cross-school tests.
    await db.collection('exam_results').doc('result_eA1_sA1').set({
      type: 'exam_result', schoolId: 'sch_A', examId: 'eA1', studentId: 'sA1',
      marks: 75, outOf: 100, percentage: 75, grade: 'C', points: 3,
      remarks: 'Good', recordedBy: 'alice',
    });
    await db.collection('exam_results').doc('result_eB1_sB1').set({
      type: 'exam_result', schoolId: 'sch_B', examId: 'eB1', studentId: 'sB1',
      marks: 75, outOf: 100, percentage: 75, grade: 'C', points: 3,
      remarks: 'Good', recordedBy: 'carol',
    });
    // Seed per-school config docs for cross-school configuration isolation tests.
    await db.collection('schools').doc('sch_A').collection('config').doc('app_config').set({
      type: 'config', schoolId: 'sch_A', schoolName: 'School A',
      academicYear: '2026', currentTerm: 'Term 1',
    });
    await db.collection('schools').doc('sch_B').collection('config').doc('app_config').set({
      type: 'config', schoolId: 'sch_B', schoolName: 'School B',
      academicYear: '2026', currentTerm: 'Term 1',
    });
    // Seed user profiles (source of truth for memberships) so config reads,
    // which go through canAccessSchool -> isMemberOfSchool, can resolve them.
    await db.collection('users').doc('alice').set({
      type: 'user', uid: 'alice', fullName: 'Alice Admin', email: 'alice@scha.example.com',
      role: 'admin', schoolId: 'sch_A', schoolIds: ['sch_A'],
      membershipActive: { sch_A: true }, active: true, platformAdmin: false,
    });
    await db.collection('users').doc('bob').set({
      type: 'user', uid: 'bob', fullName: 'Bob Teacher', email: 'bob@scha.example.com',
      role: 'teacher', schoolId: 'sch_A', schoolIds: ['sch_A'],
      membershipActive: { sch_A: true }, active: true, platformAdmin: false,
    });
    await db.collection('users').doc('carol').set({
      type: 'user', uid: 'carol', fullName: 'Carol Admin', email: 'carol@schb.example.com',
      role: 'admin', schoolId: 'sch_B', schoolIds: ['sch_B'],
      membershipActive: { sch_B: true }, active: true, platformAdmin: false,
    });
    await db.collection('users').doc('eve').set({
      type: 'user', uid: 'eve', fullName: 'Eve Platform', email: 'eve@platform.example.com',
      role: 'admin', schoolId: null, schoolIds: [],
      membershipActive: {}, active: true, platformAdmin: true,
    });
  });

  const run = [
    // 1. School A administrator accessing School A records (permitted)
    test('1. sch_A admin reads sch_A student', async () => {
      const db = as(alice).firestore();
      await assertSucceeds(db.collection('students').doc('sA1').get());
    }),
    test('1b. sch_A admin runs school-scoped query', async () => {
      const db = as(alice).firestore();
      await assertSucceeds(
        db.collection('students').where('schoolId', '==', 'sch_A').get()
      );
    }),
    // 2. School A teacher accessing permitted School A records (permitted)
    test('2. sch_A teacher reads sch_A student', async () => {
      const db = as(bob).firestore();
      await assertSucceeds(db.collection('students').doc('sA1').get());
    }),
    // 3. School A user accessing School B records (denied)
    test('3. sch_A admin reads sch_B student — DENIED', async () => {
      const db = as(alice).firestore();
      await assertFails(db.collection('students').doc('sB1').get());
    }),
    test('3b. sch_A admin query returns no sch_B docs', async () => {
      const db = as(alice).firestore();
      const snap = await assertSucceeds(
        db.collection('students').where('schoolId', '==', 'sch_A').get()
      );
      if (snap.docs.some((d) => d.data().schoolId === 'sch_B')) {
        throw new Error('sch_B doc leaked into sch_A query results');
      }
    }),
    // 4. School A user creating a School B record (denied)
    test('4. sch_A admin creates student with schoolId=sch_B — DENIED', async () => {
      const db = as(alice).firestore();
      await assertFails(
        db.collection('students').doc('evil').set({
          type: 'student', schoolId: 'sch_B', fullName: 'Evil',
          admissionNumber: 'ADM9999', status: 'active',
        })
      );
    }),
    // 5. School A user changing an existing record's schoolId (denied)
    test('5. sch_A admin changes sA1 schoolId to sch_B — DENIED', async () => {
      const db = as(alice).firestore();
      await assertFails(
        db.collection('students').doc('sA1').update({ schoolId: 'sch_B' })
      );
    }),
    test('5b. sch_A admin updates sA1 non-schoolId field — PERMITTED', async () => {
      const db = as(alice).firestore();
      await assertSucceeds(
        db.collection('students').doc('sA1').update({ fullName: 'Renamed' })
      );
    }),
    // 6. Unauthenticated access (denied)
    test('6. unauthenticated reads students — DENIED', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(db.collection('students').doc('sA1').get());
    }),
    test('6b. unauthenticated creates student — DENIED', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        db.collection('students').doc('u1').set({
          type: 'student', schoolId: 'sch_A', fullName: 'Unauthed',
          admissionNumber: 'ADM0000', status: 'active',
        })
      );
    }),
    // 7. Inactive school membership (denied)
    test('7. sch_A admin with inactive membership reads — DENIED', async () => {
      const db = as(dave).firestore();
      await assertFails(db.collection('students').doc('sA1').get());
    }),
    // 8. Suspended school access (denied)
    test('8. member of suspended school reads — DENIED', async () => {
      const db = as(fred).firestore();
      await assertFails(db.collection('students').doc('sA1').get());
    }),
    test('8b. suspended school doc is not operational — DENIED', async () => {
      const db = as(fred).firestore();
      await assertFails(
        db.collection('students').where('schoolId', '==', 'sch_suspended').get()
      );
    }),
    // 9. Platform administrator permissions (permitted across schools)
    test('9. platform admin reads sch_A student — PERMITTED', async () => {
      const db = as(eve).firestore();
      await assertSucceeds(db.collection('students').doc('sA1').get());
    }),
    test('9b. platform admin reads sch_B student — PERMITTED', async () => {
      const db = as(eve).firestore();
      await assertSucceeds(db.collection('students').doc('sB1').get());
    }),
    test('9c. platform admin creates sch_A record — PERMITTED', async () => {
      const db = as(eve).firestore();
      await assertSucceeds(
        db.collection('students').doc('eveA1').set({
          type: 'student', schoolId: 'sch_A', fullName: 'Eve A Student',
          admissionNumber: 'ADM8888', status: 'active',
        })
      );
    }),
    // 10. Attempts to escalate privileges (denied)
    test('10. sch_A admin grants self platformAdmin — DENIED', async () => {
      const db = as(alice).firestore();
      await assertFails(
        db.collection('users').doc('alice').update({ platformAdmin: true })
      );
    }),
    test('10. teacher creates student (admin-only) — DENIED', async () => {
      const db = as(bob).firestore();
      await assertFails(
        db.collection('students').doc('t1').set({
          type: 'student', schoolId: 'sch_A', fullName: 'Teacher Made',
          admissionNumber: 'ADM7777', status: 'active',
        })
      );
    }),
    test('10b. non-owner changes another user role — DENIED', async () => {
      const db = as(alice).firestore();
      await assertFails(
        db.collection('users').doc('bob').update({ role: 'admin' })
      );
    }),
    test('10c. unauthenticated writes — DENIED', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        db.collection('students').doc('u2').set({
          type: 'student', schoolId: 'sch_A', fullName: 'X',
          admissionNumber: 'ADM0000', status: 'active',
        })
      );
    }),
    // 11. Exam cross-school access attempts (Task 4 — exam service proving ground)
    test('11. sch_A admin reads sch_A exam — PERMITTED', async () => {
      const db = as(alice).firestore();
      await assertSucceeds(db.collection('exams').doc('eA1').get());
    }),
    test('11b. sch_A admin reads sch_B exam — DENIED', async () => {
      const db = as(alice).firestore();
      await assertFails(db.collection('exams').doc('eB1').get());
    }),
    test('11c. sch_A admin reads sch_A exam_result — PERMITTED', async () => {
      const db = as(alice).firestore();
      await assertSucceeds(db.collection('exam_results').doc('result_eA1_sA1').get());
    }),
    test('11d. sch_A admin reads sch_B exam_result — DENIED', async () => {
      const db = as(alice).firestore();
      await assertFails(db.collection('exam_results').doc('result_eB1_sB1').get());
    }),
    test('11e. sch_A admin creates sch_B exam — DENIED', async () => {
      const db = as(alice).firestore();
      await assertFails(
        db.collection('exams').doc('evilE').set({
          type: 'exam', schoolId: 'sch_B', name: 'Evil Exam',
          classLevel: 'S1', classStream: 'all', subjectId: 'm1',
          academicYear: '2026', term: 'Term 1', outOf: 100,
        })
      );
    }),
    test('11f. sch_A admin changes sch_A exam schoolId to sch_B — DENIED', async () => {
      const db = as(alice).firestore();
      await assertFails(
        db.collection('exams').doc('eA1').update({ schoolId: 'sch_B' })
      );
    }),
    test('11g. sch_A teacher creates sch_A exam_result — PERMITTED', async () => {
      const db = as(bob).firestore();
      await assertSucceeds(
        db.collection('exam_results').doc('result_eA1_sA2').set({
          type: 'exam_result', schoolId: 'sch_A', examId: 'eA1', studentId: 'sA2',
          marks: 60, outOf: 100, percentage: 60, grade: 'P', points: 4,
          remarks: 'Pass', recordedBy: 'bob',
        })
      );
    }),
    test('11h. sch_A teacher creates sch_B exam_result — DENIED', async () => {
      const db = as(bob).firestore();
      await assertFails(
        db.collection('exam_results').doc('result_eB1_sA1').set({
          type: 'exam_result', schoolId: 'sch_B', examId: 'eB1', studentId: 'sA1',
          marks: 60, outOf: 100, percentage: 60, grade: 'P', points: 4,
          remarks: 'Pass', recordedBy: 'bob',
        })
      );
    }),
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Milestone 2.2 additions
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Cross-school configuration isolation.
    test('12. sch_A admin reads sch_A config — PERMITTED', async () => {
      const db = as(alice).firestore();
      await assertSucceeds(db.collection('schools').doc('sch_A').collection('config').doc('app_config').get());
    }),
    test('12b. sch_A admin reads sch_B config — DENIED', async () => {
      const db = as(alice).firestore();
      await assertFails(db.collection('schools').doc('sch_B').collection('config').doc('app_config').get());
    }),
    test('12c. sch_B admin reads sch_A config — DENIED', async () => {
      const db = as(carol).firestore();
      await assertFails(db.collection('schools').doc('sch_A').collection('config').doc('app_config').get());
    }),
    // Missing school configuration: reading your own school's (absent) config
    // succeeds (returns null) but never leaks another school's config.
    test('12d. sch_C has no config; sch_A admin reads sch_C config — DENIED (not a member)', async () => {
      const db = as(alice).firestore();
      await assertFails(db.collection('schools').doc('sch_C').collection('config').doc('app_config').get());
    }),
    // Unauthenticated access to config is denied.
    test('12e. unauthenticated reads sch_A config — DENIED', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(db.collection('schools').doc('sch_A').collection('config').doc('app_config').get());
    }),
    // A client cannot create config for another school.
    test('12f. sch_A admin creates sch_B config — DENIED', async () => {
      const db = as(alice).firestore();
      await assertFails(
        db.collection('schools').doc('sch_B').collection('config').doc('app_config').set({
          type: 'config', schoolId: 'sch_B', schoolName: 'School B Hijacked',
        })
      );
    }),
  ];

  for (const r of run) await r();

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
