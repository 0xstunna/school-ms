/**
 * OFFLINE TENANT ISOLATION UNIT TESTS (Task 5)
 *
 * Tests the safe-failure behaviour of `resetPersistence()` (src/db/firebase.js):
 *   terminate -> clear IndexedDB -> reinitialize.
 *
 * It THROWS on any failure so a stale cache can never silently leak between
 * schools during a switch or sign-out.
 *
 * These tests run in plain Node (no browser, emulator, or Firebase config).
 * The firebase/firestore imports are exercised where possible; where the real
 * clearIndexedDbPersistence/initializeFirestore cannot run against a mock, the
 * tests assert the safe abort behaviour instead.
 *
 * Run: node src/services/__tests__/offlineIsolation.test.js
 */

import { resetPersistence } from '../../db/firebase.js';

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

// ── Mock Firestore instance ───────────────────────────────────────────────

function makeMockDb({ terminateShouldFail = false, terminateError = null } = {}) {
  const calls = { terminate: 0 };
  return {
    terminate: async () => {
      calls.terminate += 1;
      if (terminateShouldFail) {
        throw new Error(terminateError || 'terminate failed');
      }
    },
    get calls() { return calls; },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

const tests = [
  test('throws when Firebase is not initialized (safe failure)', async () => {
    // In plain Node there is no VITE_FIREBASE config, so firebase.js's module
    // level db is null. resetPersistence() must throw rather than proceed.
    await expectFails(resetPersistence(), 'Firestore is not initialized');
  }),

  test('operates on an injected db when provided (no module-level side effect)', async () => {
    const db = makeMockDb();
    // terminate succeeds; clearIndexedDbPersistence will run against the mock
    // and may throw (mock lacks internal persistence state). Either way the
    // injected db's terminate is exercised, proving the injected db — not the
    // null module-level db — is the target.
    try {
      await resetPersistence(db);
    } catch (e) {
      // clear/reinit may fail against a mock; that's outside this assertion.
    }
    if (db.calls.terminate !== 1) {
      throw new Error('injected db should be terminated, proving it was the target.');
    }
  }),

  test('aborts and throws when termination fails (never proceeds to clear)', async () => {
    const db = makeMockDb({ terminateShouldFail: true });
    await expectFails(resetPersistence(db), 'Failed to terminate Firestore instance');
  }),
];

console.log('\nOffline Tenant Isolation Unit Tests (resetPersistence)\n========================================================\n');
for (const t of tests) await t();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
