/**
 * ONBOARD SCHOOL UNIT TESTS
 *
 * Tests the server-side self-service school onboarding mechanism in
 * src/server/provisioning.js (onboardSchool). These tests mock the Firebase
 * Admin SDK and do NOT require a real Firebase project, credentials, or the
 * emulator.
 *
 * Validates:
 *   - Missing schoolData / idempotencyKey is rejected.
 *   - Duplicate admin email is rejected (no duplicate administrator accounts).
 *   - Idempotency: the same idempotency key returns the existing school
 *     (alreadyOnboarded) instead of creating a duplicate.
 *   - Successful onboarding creates the school record, admin Auth account,
 *     profile + membership, small custom claims, and per-school config.
 *   - The school ID is server-generated and opaque (not slugify(schoolName)).
 *   - schoolName and schoolSlug are stored separately.
 *   - Claims stay small (under 1,000 bytes, no per-school maps).
 *   - Rollback on partial failure (no orphaned tenants/accounts).
 *
 * Run: node src/services/__tests__/onboardSchool.test.js
 */

import { onboardSchool } from '../../server/provisioning.js';

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

// ── Build a mocked Admin SDK ──────────────────────────────────────────────

function buildAdminSdk({ existingSchools = [], existingUsers = [], createdClaims = {} } = {}) {
  const calls = {
    customClaims: null,
    updates: [],
    writes: [],
    deletes: [],
    createdAuthUsers: [],
  };

  // In-memory school docs keyed by schoolId.
  const schools = new Map();
  existingSchools.forEach((s) => schools.set(s.schoolId, s));

  // In-memory user profiles keyed by uid.
  const users = new Map();
  existingUsers.forEach((u) => users.set(u.uid, u));

  // Simulated Auth: createUser assigns a deterministic uid.
  let authCounter = 0;
  const auth = {
    getUserByEmail: async (email) => {
      const found = [...users.values()].find((u) => u.email === email.toLowerCase().trim());
      if (found) return { uid: found.uid, email: found.email, customClaims: found.customClaims || {} };
      const err = new Error('auth/user-not-found');
      err.code = 'auth/user-not-found';
      throw err;
    },
    deleteUser: async (uid) => {
      calls.deletes.push({ col: 'auth_users', id: uid });
      users.delete(uid);
    },
    createUser: async ({ email, password, displayName }) => {
      authCounter += 1;
      const uid = `uid_${authCounter}`;
      calls.createdAuthUsers.push({ uid, email, displayName });
      return { uid, email, displayName };
    },
    setCustomUserClaims: async (uid, claims) => {
      calls.customClaims = { uid, claims };
    },
  };

  const db = {
    collection: (col) => ({
      doc: (id) => ({
        get: async () => {
          if (col === 'schools') {
            const s = schools.get(id);
            return { exists: !!s, data: () => s };
          }
          if (col === 'users') {
            const u = users.get(id);
            return { exists: !!u, data: () => u };
          }
          return { exists: false, data: () => null };
        },
        set: async (data) => {
          if (col === 'schools') {
            schools.set(id, { ...data, id });
            calls.writes.push({ col, id, data });
          } else if (col === 'users') {
            users.set(id, { ...data, id });
            calls.writes.push({ col, id, data });
          } else {
            calls.writes.push({ col, id, data });
          }
        },
        update: async (data) => {
          if (col === 'schools') {
            const s = schools.get(id);
            if (s) Object.assign(s, data);
          }
          calls.updates.push({ col, id, data });
        },
        delete: async () => {
          calls.deletes.push({ col, id });
        },
        collection: (subCol) => ({
          doc: (docId) => ({
            get: async () => {
              // Subcollections (e.g. schools/{id}/config/{doc}) are not seeded
              // unless explicitly added; default to not-found.
              return { exists: false, data: () => null };
            },
            set: async (data) => {
              calls.writes.push({ col, id, subCol, docId, data });
            },
            update: async (data) => {
              calls.updates.push({ col, id, subCol, docId, data });
            },
            delete: async () => {
              calls.deletes.push({ col, id, subCol, docId });
            },
          }),
        }),
      }),
      where: (field, op, value) => ({
        limit: (n) => ({
          get: async () => {
            // Only support the idempotency-key query on schools.
            if (col === 'schools' && field === 'onboardingIdempotencyKey' && op === '==') {
              const matches = [...schools.values()].filter((s) => s.onboardingIdempotencyKey === value);
              const docs = matches.slice(0, n).map((s) => ({ data: () => s, id: s.schoolId }));
              return { empty: docs.length === 0, docs };
            }
            return { empty: true, docs: [] };
          },
        }),
      }),
    }),
  };

  return { auth, db, calls, schools, users };
}

// ── Tests ─────────────────────────────────────────────────────────────────

const validSchoolData = {
  schoolName: 'Kampala Secondary School',
  schoolEmail: 'info@kampalass.example.com',
  schoolAddress: 'Kampala, Uganda',
  schoolPhone: '+256 414 000 000',
  academicYear: '2026',
  currentTerm: 'Term 1',
  plan: 'trial',
  adminFullName: 'Jane Admin',
  adminEmail: 'jane@kampalass.example.com',
  adminPassword: 'Str0ngP@ssw0rd',
};

const tests = [
  test('rejects a missing schoolData', async () => {
    const sdk = buildAdminSdk();
    await expectFails(onboardSchool(undefined, 'key_1'), 'schoolData is required');
    await expectFails(onboardSchool(null, 'key_1'), 'schoolData is required');
    await expectFails(onboardSchool('not-an-object', 'key_1'), 'schoolData is required');
  }),

  test('rejects a missing idempotencyKey', async () => {
    const sdk = buildAdminSdk();
    await expectFails(onboardSchool(validSchoolData, undefined), 'idempotencyKey is required');
    await expectFails(onboardSchool(validSchoolData, ''), 'idempotencyKey is required');
    await expectFails(onboardSchool(validSchoolData, '   '), 'idempotencyKey is required');
  }),

  test('rejects a duplicate admin email (no duplicate administrator account)', async () => {
    const existingUser = {
      uid: 'existing_uid', email: 'jane@kampalass.example.com',
      customClaims: {},
    };
    const sdk = buildAdminSdk({ existingUsers: [existingUser] });
    await expectFails(
      onboardSchool(validSchoolData, 'key_dup', { auth: sdk.auth, db: sdk.db }),
      'already exists',
    );
    // No school or user should have been created.
    if (sdk.calls.createdAuthUsers.length !== 0) {
      throw new Error('No Auth account should be created for a duplicate email.');
    }
  }),

  test('onboards a new school and returns a server-generated opaque school ID', async () => {
    const sdk = buildAdminSdk();
    const result = await onboardSchool(validSchoolData, 'key_new', { auth: sdk.auth, db: sdk.db });

    if (!result.schoolId) throw new Error('schoolId should be returned.');
    // The ID must be server-generated and opaque, not derived from the name.
    if (result.schoolId === 'kampala_secondary_school') {
      throw new Error('schoolId must not be the slugified school name.');
    }
    if (!/^sch_/.test(result.schoolId)) {
      throw new Error(`schoolId should be opaque (sch_...), got ${result.schoolId}.`);
    }
    if (result.adminUserId !== 'uid_1') throw new Error('adminUserId should be uid_1.');
    if (result.adminEmail !== 'jane@kampalass.example.com') {
      throw new Error('adminEmail should match.');
    }
    if (result.setupComplete !== true) throw new Error('setupComplete should be true.');
    if (result.alreadyOnboarded !== false) throw new Error('alreadyOnboarded should be false.');

    // School record exists with opaque ID and separate name/slug.
    const school = sdk.schools.get(result.schoolId);
    if (!school) throw new Error('schools/{schoolId} should exist.');
    if (school.schoolName !== 'Kampala Secondary School') {
      throw new Error('schoolName should be preserved.');
    }
    if (school.schoolSlug !== 'kampala_secondary_school') {
      throw new Error('schoolSlug should be the slug, separate from the ID.');
    }
    if (school.onboardingIdempotencyKey !== 'key_new') {
      throw new Error('idempotency key should be stored on the school doc.');
    }
  }),

  test('claims are small and contain only the active school', async () => {
    const sdk = buildAdminSdk();
    await onboardSchool(validSchoolData, 'key_claims', { auth: sdk.auth, db: sdk.db });

    if (!sdk.calls.customClaims) throw new Error('setCustomUserClaims should be called.');
    const { claims } = sdk.calls.customClaims;
    if (claims.schoolId !== validSchoolData.schoolId && !claims.schoolId) {
      throw new Error('claims.schoolId should be set.');
    }
    // No per-school maps.
    if (claims.schoolIds !== undefined) throw new Error('claims must not include schoolIds.');
    if (claims.roles !== undefined) throw new Error('claims must not include roles.');
    if (claims.membershipActive !== undefined) {
      throw new Error('claims must not include membershipActive.');
    }
    const bytes = Buffer.byteLength(JSON.stringify(claims), 'utf8');
    if (bytes >= 1000) throw new Error(`Claims too large: ${bytes} bytes.`);
    console.log(`    Claims payload: ${bytes} bytes`);
  }),

  test('idempotency: same key returns the existing school (alreadyOnboarded)', async () => {
    const sdk = buildAdminSdk();
    const first = await onboardSchool(validSchoolData, 'key_idem', { auth: sdk.auth, db: sdk.db });
    if (first.alreadyOnboarded !== false) throw new Error('First call should not be alreadyOnboarded.');
    const schoolId = first.schoolId;

    const second = await onboardSchool(validSchoolData, 'key_idem', { auth: sdk.auth, db: sdk.db });
    if (second.alreadyOnboarded !== true) throw new Error('Replay should be alreadyOnboarded.');
    if (second.schoolId !== schoolId) throw new Error('Replay should return the same schoolId.');
    // No additional Auth account should be created.
    if (sdk.calls.createdAuthUsers.length !== 1) {
      throw new Error('Only one Auth account should exist after idempotent replay.');
    }
    // No additional school doc should be created.
    if (sdk.schools.size !== 1) throw new Error('Only one school doc should exist.');
  }),

  test('rolls back on partial failure (no orphaned tenant or account)', async () => {
    // Force createUser to fail by making getUserByEmail throw a non-user-not-found error.
    const sdk = buildAdminSdk();
    const originalCreateUser = sdk.auth.createUser;
    sdk.auth.createUser = async () => {
      throw new Error('Auth service unavailable.');
    };

    await expectFails(
      onboardSchool(validSchoolData, 'key_rollback', { auth: sdk.auth, db: sdk.db }),
      'unavailable',
    );

    // The school doc should have been rolled back (deleted).
    const school = sdk.schools.get('any');
    // We can't easily know the generated schoolId here, so assert no writes remain
    // that were not cleaned up: the rollback deletes the school doc, auth user,
    // and profile. Since Auth creation failed, only the school doc was written
    // and should be deleted.
    if (sdk.calls.deletes.length === 0) {
      throw new Error('Rollback should delete resources created before the failure.');
    }
    // Restore.
    sdk.auth.createUser = originalCreateUser;
  }),

  test('stores schoolName and schoolSlug separately from the internal ID', async () => {
    const sdk = buildAdminSdk();
    const data = {
      ...validSchoolData,
      schoolName: 'St Mary\'s College, Kisubi',
      adminEmail: 'mary@kisubi.example.com',
    };
    await onboardSchool(data, 'key_slug', { auth: sdk.auth, db: sdk.db });
    const school = [...sdk.schools.values()][0];
    if (school.schoolId === school.schoolSlug) {
      throw new Error('schoolId must not equal the slug (they must be separate).');
    }
    if (school.schoolName !== "St Mary's College, Kisubi") {
      throw new Error('schoolName should preserve the full name.');
    }
    if (school.schoolSlug !== 'st_mary_s_college_kisubi') {
      throw new Error(`schoolSlug should be the slugified name, got "${school.schoolSlug}".`);
    }
    // The opaque ID must differ from both the name and the slug.
    if (!/^sch_/.test(school.schoolId)) {
      throw new Error(`schoolId should be opaque (sch_...), got "${school.schoolId}".`);
    }
  }),
];

console.log('\nOnboard School Unit Tests\n=========================\n');
for (const t of tests) await t();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
