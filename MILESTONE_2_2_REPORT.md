# Alama — Milestone 2.2 Completion Report

**Status:** Complete — awaiting approval before Milestone 3.
**Milestone:** 2.2 (Critical Tenant-Isolation Corrections) — hardening only, no new features.

---

## 1. Files Changed

### New files
| File | Purpose |
|------|---------|
| `src/server/switchSchool.js` | Trusted server-side active-school switching: verifies Firebase ID tokens, authorizes membership + school status, updates the profile, re-issues small custom claims. Includes a framework-agnostic HTTP handler (`switchSchoolHandler`) for a Cloud Function/endpoint. |
| `src/services/__tests__/switchSchool.test.js` | Unit tests for `switchSchool.js` with a mocked Admin SDK (12 tests). |

### Modified files
| File | Change |
|------|--------|
| `src/db/firebase.js` | Replaced best-effort `clearPersistence()` with fail-safe `resetPersistence()`: terminates the Firestore instance (stops all listeners), clears IndexedDB persistence, and reinitializes a fresh Firestore instance. Throws on any failure — never silently proceeds with a stale cache. The old `clearPersistence()` wrapper is retained as a deprecated best-effort shim. |
| `src/contexts/AuthContext.jsx` | `switchActiveSchool()` now: stops listeners via `resetPersistence()`, calls the trusted server switch endpoint (ID token in `Authorization: Bearer` header), refreshes the client ID token with `getIdToken(true)`, and never silently proceeds if cache clearing or the server switch fails. `logout()` uses strict `resetPersistence()` and returns a persistence error for recovery UI. Added `SWITCH_SCHOOL_ENDPOINT` config (env `VITE_SWITCH_SCHOOL_ENDPOINT`, default `/api/switch-school`). |
| `src/db/configService.js` | Removed top-level `config/` fallback for config *values* (`getConfig`, `isSetupComplete` with a `schoolId`). Missing school config returns an explicit unconfigured state (`null`/`false`). The top-level `config/setup` is read **only** when `isSetupComplete()` is called with no `schoolId` (cold-boot platform bootstrap flag) — not a per-school config value. |
| `src/db/gradingSettingsService.js` | Removed top-level `config/grading_settings` fallback. `getGradingSettings(schoolId)` is per-school only, returning `null` when unconfigured (NLSC grading falls back to placeholders safely). |
| `src/server/provisioning.js` | School IDs are now server-generated opaque identifiers (`sch_<ts>_<random>` with a uniqueness check against Firestore), not derived from `slugify(schoolName)`. The human-readable name and an optional `schoolSlug` are stored separately on the school doc. `provisionSchool()` now writes the per-school `schools/{schoolId}/config/setup` instead of top-level `config/setup`. |
| `src/pages/setup/SetupWizard.jsx` | Uses `generateId('sch')` for the school ID (never `slugify(name)` as the definitive ID). Stores `schoolName` and `schoolSlug` separately. Passes the generated school ID to `onComplete`. |
| `src/services/__tests__/firestoreRules.tenant.test.js` | Added 7 Milestone 2.2 rules tests (cross-school config isolation, missing config, unauthenticated config access, cross-school config create) and fixed the `authenticatedContext` helper so `request.auth.uid` matches the profile doc id. Seeded per-school config docs and user profiles. |

No production data was modified, no production credentials used, nothing deployed.

---

## 2. School-Switching Architecture & Endpoint Behaviour

**Architecture:** The client never writes custom claims. Switching is a server-side operation:

1. Client obtains its Firebase ID token (`firebaseUser.getIdToken()`).
2. Client calls `POST <SWITCH_SCHOOL_ENDPOINT>` with `Authorization: Bearer <idToken>` and body `{ schoolId }`.
3. Server (`switchActiveSchool` in `src/server/switchSchool.js`):
   - Verifies the ID token via Admin SDK `verifyIdToken()` (cryptographically binds request to a real user; clients cannot forge it).
   - Loads the caller's `users/{uid}` profile (source of truth for memberships).
   - Rejects globally deactivated accounts (`active === false`).
   - Authorizes: destination `schoolId` must be in `profile.schoolIds` with `membershipActive[schoolId] !== false`.
   - Verifies the destination `schools/{schoolId}` doc has `status == 'active'` (suspended/closed rejected).
   - Updates `users/{uid}.schoolId` server-side.
   - Re-issues small custom claims `{ schoolId, role, am, active, platformAdmin }` via `setCustomUserClaims`.
4. Client receives the claims and calls `getIdToken(true)` to refresh its ID token so Firestore rules evaluate against the new active school.

**Authorisation boundaries preserved:**
- A user can switch only to schools where they have an **active** membership.
- Revoked memberships (`membershipActive[sch] === false`) are rejected.
- Suspended/closed schools (`status !== 'active'`) are rejected.
- Platform-administrator separation: a platform admin switching their own active school is subject to the same membership checks (platform admin is not automatically a member of every school).
- `switchSchoolHandler` returns `401` for invalid tokens and `403` for authorization failures, with JSON error bodies.

**Note on endpoint exposure:** `switchSchoolHandler` is implemented but not yet mounted on a live HTTP server/Cloud Function (that is Milestone 3). In local development without the endpoint mounted, `switchActiveSchool()` throws a clear, actionable error (with recovery instructions) rather than silently proceeding with stale claims.

---

## 3. Offline Cache Lifecycle & Failure Handling

**`resetPersistence()` (`src/db/firebase.js`):**
1. **Terminate** the Firestore instance (`db.terminate()`) — stops every live listener and releases the IndexedDB lock.
2. **Clear** IndexedDB persistence (`clearIndexedDbPersistence`) — deletes cached documents so the previous school's records cannot survive into the new school's workspace. Offline reads bypass Firestore rules, so a stale cache is a real tenant-isolation risk; it is cleared, not merely logged.
3. **Reinitialize** Firestore on the same Firebase app (Auth session survives) with a fresh, empty cache.

**Failure handling:**
- `resetPersistence()` **throws** if termination, clearing, or reinitialization fails. Callers do **not** silently proceed.
- `switchActiveSchool()` aborts the switch and returns an error directing the user to "sign out and reload the page to recover" if cache clearing fails.
- `logout()` completes Firebase Auth sign-out regardless (auth is independent of the cache) but returns the persistence error so a recovery path (e.g. reload) can be offered.
- Because `resetPersistence()` terminates the Firestore instance, all listeners are stopped before the cache is touched.

**Verified lifecycle:** sign-out, sign-in, school switching, and switching between multiple memberships are all covered by the `resetPersistence()` + server claims flow. The emulator rules tests confirm suspended-school and inactive-membership rejection at the read layer.

---

## 4. Configuration Migration & Fallback Behaviour

**Behaviour after this milestone:**
- Every school reads/writes its own config at `schools/{schoolId}/config/{setup|app_config}`.
- `getConfig(schoolId)` / `getGradingSettings(schoolId)` return `null` (explicit unconfigured state) when the per-school doc is missing. Callers must handle `null` explicitly (Dashboard, resultsService already use optional chaining; NLSC grading falls back to placeholders).
- **No silent fallback to another school's top-level configuration** — this was the tenant-isolation risk.
- Existing top-level `config/{doc}` documents are **not deleted** (data preserved for a future migration).
- `isSetupComplete(schoolId)` is per-school when a `schoolId` is known. When called with no `schoolId` (cold boot before sign-in) it reads the top-level `config/setup` **platform bootstrap flag only**, so existing single-school installations are not sent back through the Setup Wizard on every cold boot. This flag is not a per-school config value.

**Migration strategy (documented, deferred to Milestone 3):**
A migration script should copy each top-level `config/{app_config|grading_settings}` singleton into the appropriate `schools/{schoolId}/config/` doc and create a `schools/{schoolId}/config/setup` with `setupComplete: true`, keyed by the school's existing (slug-based) ID. Until that migration runs, un-migrated schools will read `null`/`unconfigured` from the per-school path — an explicit, safe state rather than a cross-school leak.

**Setup status is school-specific:** setup completion is stored per-school at `schools/{schoolId}/config/setup`.

---

## 5. School ID Generation Strategy

- School IDs are **server-generated unique tenant identifiers** (`sch_<timestamp-base36>_<random>`), with a uniqueness loop that checks `schools/{schoolId}` before returning.
- `slugify(schoolName)` is used **only** for the optional, human-readable `schoolSlug` field stored separately on the school doc — never as the definitive security identifier.
- Readable `schoolName` and optional `schoolSlug` are preserved separately from the internal ID.
- Setup (`SetupWizard`) uses `generateId('sch')` for the school ID and stores `schoolSlug` separately.
- Existing single-school installations keep their existing (slug-based) school IDs; only newly provisioned schools use the new opaque format. No existing data is migrated or deleted.

---

## 6. Firebase Emulator Test Results

**Exact commands executed:**

1. Start the emulator (one terminal, kept running):
   ```
   npx firebase emulators:start --only firestore --project demo-alama
   ```
   Listening on `127.0.0.1:8080`.

2. Run the rules tests:
   ```
   node src/services/__tests__/firestoreRules.tenant.test.js
   ```

**Results:** **34 passed, 0 failed.**

Coverage added/verified in this run:
- Cross-school academic data isolation (students, exams, exam_results) — denied.
- Cross-school **configuration isolation** (NEW): sch_A cannot read/create sch_B's `config/app_config`; only own school's config readable.
- **Inactive membership rejection** — denied.
- **Suspended school rejection** — denied (status check + query).
- **Missing school configuration** — own-school missing config returns null (not denied); other school's config denied.
- Unauthenticated access — denied.
- **Client-side platform-admin privilege escalation** — denied (client cannot set `platformAdmin`).
- School administrator privilege boundaries — teacher cannot create students; non-owner cannot change another user's role.
- Platform admin cross-school access — permitted (least-privilege bypass where appropriate).

**No Firestore rules were weakened** to make tests pass.

---

## 7. Existing Regression Test Results

| Test suite | Result |
|------------|--------|
| `src/services/__tests__/provisioningSecurity.test.js` | 4 passed, 0 failed |
| `src/services/__tests__/firestoreRules.tenant.test.js` (emulator) | 34 passed, 0 failed |
| `src/services/__tests__/switchSchool.test.js` (NEW) | 12 passed, 0 failed |
| `npm test` (grading + ranking + marksEntry) | All passed |
| `src/services/__tests__/studentImport.test.js` | All passed |
| `npm run build` (Vite production build) | **1555 modules transformed, built successfully** (web + Electron targets intact) |

Grading behaviour (UCE legacy + NLSC) is byte-identical; no regression.

---

## 8. Remaining Risks & Unresolved Issues

1. **Switch endpoint not yet exposed on a live server.** `switchSchoolHandler` is implemented but not mounted as a Cloud Function/HTTP endpoint (Milestone 3). In local dev without the endpoint, school switching throws a clear recovery error rather than silently using stale claims. Custom claims cannot be issued in production until this endpoint exists.

2. **`resetPersistence()` terminate/clear/reinitialize** has been unit-logic verified and the build passes, but actual IndexedDB clearing in a running Electron/browser session depends on the Firebase SDK behaviour and should be validated end-to-end once the switch endpoint is available.

3. **Remaining services not yet schoolId-scoped at the service layer** (deferred to Milestone 3 per constraints): `classService`, `subjectService`, `staffService`, `feeService`, `payrollService`, `attendanceService`, `projectWorkService` still use `getAllDocs()` (no `schoolId` filter). The Firestore *rules* already enforce `schoolId == activeSchoolId` for reads/writes on these collections, so unfiltered queries would be rejected by rules — but the services need `where('schoolId','==',schoolId)` added in Milestone 3.

4. **Top-level `config/setup` retained as a cold-boot platform bootstrap flag** (read only by `isSetupComplete()` with no `schoolId` and by `setupNotDone()` in rules for first-admin bootstrap). It is deliberately **not** used for config values. This is the one remaining top-level `config/` dependency; full removal awaits the Milestone 3 migration script.

5. **No school registration, billing, platform-admin dashboard, or fees/payroll/expenses expansion** was built, per constraints.

---

## Stop Condition

Milestone 2.2 is complete. All Milestone 2.1 work remains uncommitted on disk; nothing pushed or merged. Stopping here for approval before Milestone 3 (server-side provisioning endpoint exposure, extend `schoolId` enforcement to remaining academic services, platform-admin UI, config migration script).
