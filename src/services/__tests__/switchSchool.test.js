/**
 * SWITCH SCHOOL UNIT TESTS
 *
 * Tests the server-side active-school switching mechanism in
 * src/server/switchSchool.js with a mocked Firebase Admin SDK.
 *
 * These tests do NOT require a real Firebase project, credentials, or the
 * emulator. They validate:
 *   - Invalid/missing ID token is rejected.
 *   - Missing schoolId is rejected.
 *   - A valid token + active membership + operational school switches OK and
 *     re-issues small claims.
 *   - Switching to a school the user is not a member of is rejected.
 *   - An inactive membership is rejected.
 *   - A suspended/closed school is rejected.
 *   - A deactivated account is rejected.
 *   - Custom claims stay small (no schoolIds/roles/membershipActive).
 *
 * Run: node src/services/__tests__/switchSchool.test.js
 */

import { switchActiveSchool } from '../../server/switchSchool.js';

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
    throw new Error(`Expected promise to reject but it resolved.`);
  } catch (e) {
    if (expectedMessage && !String(e.message).includes(expectedMessage)) {
      throw new Error(`Expected error to include "${expectedMessage}" but got "${e.message}".`);
    }
  }
}

// ── Build a mocked Admin SDK ──────────────────────────────────────────────

function buildAdminSdk({ profile, school, tokenUid = 'alice' } = {}) {
  const calls = { customClaims: null, updates: [] };

  const auth = {
    verifyIdToken: async (idToken) => {
      if (!idToken || idToken === 'invalid') throw new Error('auth/invalid-id-token');
      return { uid: tokenUid };
    },
    setCustomUserClaims: async (uid, claims) => {
      calls.customClaims = { uid, claims };
    },
  };

  const db = {
    collection: (col) => ({
      doc: (id) => ({
        get: async () => {
          if (col === 'users') {
            return {
              exists: !!profile,
              data: () => profile,
            };
          }
          if (col === 'schools') {
            return {
              exists: !!school,
              data: () => school,
            };
          }
          return { exists: false, data: () => null };
        },
        update: async (data) => {
          calls.updates.push({ id, data });
        },
      }),
    }),
  };

  return { auth, db, calls };
}

// ── Tests ─────────────────────────────────────────────────────────────────

const activeProfile = {
  type: 'user', uid: 'alice', email: 'alice@scha.example.com',
  schoolId: 'sch_A', schoolIds: ['sch_A', 'sch_B'],
  membershipActive: { sch_A: true, sch_B: true },
  roles: { sch_A: ['admin'], sch_B: ['teacher'] },
  active: true, platformAdmin: false,
};
const activeSchool = { type: 'school', schoolId: 'sch_A', schoolName: 'School A', status: 'active' };

const tests = [
  test('rejects a missing idToken', async () => {
    const { auth, db } = buildAdminSdk({ profile: activeProfile, school: activeSchool });
    await expectFails(switchActiveSchool(undefined, 'sch_A', { auth, db }), 'idToken is required');
    await expectFails(switchActiveSchool('', 'sch_A', { auth, db }), 'idToken is required');
  }),

  test('rejects an invalid idToken', async () => {
    const { auth, db } = buildAdminSdk({ profile: activeProfile, school: activeSchool });
    await expectFails(switchActiveSchool('invalid', 'sch_A', { auth, db }), 'Invalid or expired ID token');
  }),

  test('rejects a missing schoolId', async () => {
    const { auth, db } = buildAdminSdk({ profile: activeProfile, school: activeSchool });
    await expectFails(switchActiveSchool('valid-token', undefined, { auth, db }), 'schoolId is required');
  }),

  test('switches to an active member school and re-issues small claims', async () => {
    const { auth, db, calls } = buildAdminSdk({
      profile: activeProfile, school: activeSchool,
    });
    const result = await switchActiveSchool('valid-token', 'sch_A', { auth, db });

    if (result.uid !== 'alice') throw new Error('uid should be alice, got ' + result.uid);
    if (result.schoolId !== 'sch_A') throw new Error('schoolId should be sch_A');
    if (!result.claims) throw new Error('claims should be returned');
    if (result.claims.schoolId !== 'sch_A') throw new Error('claims.schoolId should be sch_A');
    if (result.claims.role !== 'admin') throw new Error('claims.role should be admin');
    if (result.claims.am !== true) throw new Error('claims.am should be true');
    if (result.claims.platformAdmin !== false) throw new Error('claims.platformAdmin should be false');

    // Claims must stay small — no per-school maps.
    if (result.claims.schoolIds !== undefined) throw new Error('claims must not include schoolIds.');
    if (result.claims.roles !== undefined) throw new Error('claims must not include roles.');
    if (result.claims.membershipActive !== undefined) throw new Error('claims must not include membershipActive.');
    const bytes = Buffer.byteLength(JSON.stringify(result.claims), 'utf8');
    if (bytes >= 1000) throw new Error(`Claims too large: ${bytes} bytes.`);

    // Profile updated server-side.
    const profileUpdate = calls.updates.find((u) => u.id === 'alice');
    if (!profileUpdate) throw new Error('users/{uid} should be updated server-side.');
    if (profileUpdate.data.schoolId !== 'sch_A') throw new Error('profile schoolId should be updated to sch_A.');
    if (profileUpdate.data.updatedAt === undefined) throw new Error('profile updatedAt should be set.');

    // Custom claims re-issued.
    if (!calls.customClaims) throw new Error('setCustomUserClaims should be called.');
    if (calls.customClaims.uid !== 'alice') throw new Error('claims should be set for alice.');
    console.log(`    Claims payload: ${bytes} bytes`);
  }),

  test('switches to a second membership school with that school’s role', async () => {
    const profile = {
      ...activeProfile, schoolIds: ['sch_A', 'sch_B'],
      roles: { sch_A: ['admin'], sch_B: ['teacher'] },
      membershipActive: { sch_A: true, sch_B: true },
    };
    const schoolB = { type: 'school', schoolId: 'sch_B', schoolName: 'School B', status: 'active' };
    const { auth, db, calls } = buildAdminSdk({ profile, school: schoolB });
    const result = await switchActiveSchool('valid-token', 'sch_B', { auth, db });

    if (result.claims.role !== 'teacher') throw new Error('claims.role should reflect the target school role (teacher), got ' + result.claims.role);
    if (calls.customClaims.claims.schoolId !== 'sch_B') throw new Error('claims.schoolId should be sch_B.');
  }),

  test('rejects switching to a school the user is not a member of', async () => {
    const { auth, db } = buildAdminSdk({ profile: activeProfile, school: activeSchool });
    await expectFails(switchActiveSchool('valid-token', 'sch_Z', { auth, db }), 'not a member of this school');
  }),

  test('rejects switching when membership is inactive', async () => {
    const profile = {
      ...activeProfile,
      membershipActive: { sch_A: true, sch_B: false },
    };
    const schoolB = { type: 'school', schoolId: 'sch_B', schoolName: 'School B', status: 'active' };
    const { auth, db } = buildAdminSdk({ profile, school: schoolB });
    await expectFails(switchActiveSchool('valid-token', 'sch_B', { auth, db }), 'membership in this school is inactive');
  }),

  test('rejects switching to a suspended school', async () => {
    const suspendedSchool = {
      type: 'school', schoolId: 'sch_A', schoolName: 'School A', status: 'suspended',
    };
    const { auth, db } = buildAdminSdk({ profile: activeProfile, school: suspendedSchool });
    await expectFails(switchActiveSchool('valid-token', 'sch_A', { auth, db }), 'suspended');
  }),

  test('rejects switching to a closed school', async () => {
    const closedSchool = {
      type: 'school', schoolId: 'sch_A', schoolName: 'School A', status: 'closed',
    };
    const { auth, db } = buildAdminSdk({ profile: activeProfile, school: closedSchool });
    await expectFails(switchActiveSchool('valid-token', 'sch_A', { auth, db }), 'closed');
  }),

  test('rejects switching for a deactivated account', async () => {
    const profile = { ...activeProfile, active: false };
    const { auth, db } = buildAdminSdk({ profile, school: activeSchool });
    await expectFails(switchActiveSchool('valid-token', 'sch_A', { auth, db }), 'deactivated');
  }),

  test('allows switching to a school with no schools/{schoolId} doc (transitional)', async () => {
    const { auth, db, calls } = buildAdminSdk({
      profile: activeProfile, school: undefined, // no school doc
    });
    const result = await switchActiveSchool('valid-token', 'sch_A', { auth, db });
    if (result.schoolId !== 'sch_A') throw new Error('transitional school without doc should be allowed.');
    if (!calls.customClaims) throw new Error('claims should still be issued for transitional school.');
  }),

  test('preserves platform-admin separation (platformAdmin claim carried through)', async () => {
    const profile = {
      ...activeProfile,
      platformAdmin: true,
      schoolIds: ['sch_A'],
      membershipActive: { sch_A: true },
    };
    const { auth, db, calls } = buildAdminSdk({
      profile, school: activeSchool,
    });
    const result = await switchActiveSchool('valid-token', 'sch_A', { auth, db });
    if (result.claims.platformAdmin !== true) throw new Error('platformAdmin claim should be preserved.');
  }),
];

console.log('\nSwitch School Unit Tests\n========================\n');
for (const t of tests) await t();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
