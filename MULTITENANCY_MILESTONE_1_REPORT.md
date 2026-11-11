# Alama — Multi-Tenancy Milestone 1 Completion Report

**Status:** COMPLETE — awaiting approval before proceeding to the next phase.
**Scope honored:** Tenant identity design, Firestore security rules, emulator tests, and one proving-ground service (`studentService.js`) only. No production data touched, no rules deployed to production, no school registration, no billing, no UI redesign, no other academic services modified.

---

## 1. Tenant identity model selected and justification

Documented in `TENANT_IDENTITY_MODEL.md`.

### Selected model: Claims-asserted active school + membership source of truth

| Question | Decision |
|---|---|
| **How users are identified** | Firebase Auth UID (`firebaseUser.uid`), platform-global email/password account. Profile stored in `users/{uid}`. |
| **How users belong to schools** | Membership data on `users/{uid}` (`schoolIds[]`, per-school `membershipActive`) mirrored into Firebase Auth **custom claims** at sign-in / membership change. |
| **How school roles are assigned** | Per school. For this proving-ground milestone the active school's role is carried as a flat `role` claim (matching the existing single `role` field on `users/{uid}`). Per-school role maps can be reintroduced when AuthContext resolves roles across multiple memberships. |
| **Can a user belong to multiple schools?** | **Yes — explicitly established.** `schoolIds[]` + per-school `membershipActive` support multi-school membership. The app does NOT assume exactly one school per user. |
| **Authoritative source for access** | **Runtime:** Firebase Auth custom claims (`request.auth.token.*`) — cryptographically signed, unforgeable by the client. **Source of truth:** `users/{uid}` profile + `schools/{schoolId}` document; claims regenerated server-side on sign-in / membership change. |
| **Platform admin vs. school admin** | Platform admin = `platformAdmin: true` claim (distinct from any school `admin` role). Platform admin can read any school's data but does NOT auto-get school-admin academic access unless granted a membership. School admin = `role: 'admin'` for their active school only. |

### Justification (simplest secure design)

- One `schoolId` field on every academic document (top-level collections, Option A from the assessment) — minimal data-model change, preserves collection names/doc IDs/service signatures.
- Claims carry active school + memberships + role so rules enforce `resource.data.schoolId == request.auth.token.schoolId` with no extra document read.
- No subcollections, no backend rearchitecture in this milestone.
- Explicit multi-school support rather than assuming one school per user.

---

## 2. Files changed

| File | Change |
|---|---|
| `TENANT_IDENTITY_MODEL.md` | **NEW** — documents the selected tenant identity and access-control model. |
| `firestore.rules` | **REWRITTEN** — full tenant-isolation rules (see §3). |
| `src/db/studentService.js` | **MODIFIED** — tenant-aware reads/writes (see §5). |
| `src/services/__tests__/firestoreRules.tenant.test.js` | **NEW** — Firebase Emulator rules unit tests (see §4). |

**Not modified (preserved):** all other academic services (`examService`, `classService`, etc.), `src/gradingSystems/*` (UCE + NLSC untouched), `electron/*`, `src/lib/*`, `src/components/*`, `.env`, `firestore.deploy` (none), production data.

---

## 3. Firestore rules implemented (`firestore.rules`)

### Claim shape (runtime authority)
```
{
  schoolId: 'sch_A',                 // active (selected) school
  schoolIds: ['sch_A','sch_B'],      // every school the user is a member of
  role: 'admin' | 'teacher' | 'bursar',   // role for the active school
  membershipActive: { sch_A: true, ... }, // per-school membership active flag
  active: true,                      // globally active / deactivated
  platformAdmin: false               // platform administrator (distinct)
}
```

### Core enforcement (every academic collection)
- **Read:** `resource.data.schoolId == activeSchoolId()` (caller's active school) OR platform admin; plus active membership + school operational.
- **Create:** incoming `schoolId` MUST equal `activeSchoolId()` (client cannot choose another tenant's ID) — `validSchoolIdOnCreate()`.
- **Update:** `schoolId` is immutable — `request.resource.data.schoolId == resource.data.schoolId` AND `== activeSchoolId()` — `validSchoolIdOnUpdate()`.
- **Delete:** `students` `allow delete: if false` (students deactivated, never deleted).
- **Queries:** Firestore rejects any query without a `where('schoolId','==',activeSchoolId)` filter, because the read rule can only be satisfied by active-school documents.
- **Default:** `match /{document=**} { allow read, write: if false; }`.

### Additional protections
- **Inactive school membership:** denied via `membershipIsActive(activeSchoolId())` (claims).
- **Suspended school:** denied via `schoolIsOperational()` reading `schools/{schoolId}.status` (`active` required).
- **Privilege escalation:** `platformAdmin` can never be set/changed by a client (`touchesPlatformAdmin()` blocked on all user-update paths; assigned server-side only).
- **Unauthenticated:** denied (`isSignedIn()` required for all school data).
- **`schools/{schoolId}` tenant root:** create/update restricted to platform admin.
- **`config/` singletons:** left top-level/transitional (cold-boot readable `setup`/`app_config`; admin writes) — per-school config is deferred to a later step.
- **`users/{uid}`:** role/active changes admin-only; self-update cannot touch `role`/`active`/`platformAdmin`.

Rules cover `create`, `read`, `query` (via rule-implied filter), `update`, and `delete` separately for every collection (`students`, `exams`, `exam_results`, `projectWork`, `classes`, `subjects`, `staff`, `attendance`, `fee_structures`, `fee_payments`, `payroll`, `expenses`).

---

## 4. Emulator test cases and results

**File:** `src/services/__tests__/firestoreRules.tenant.test.js`

**Environment:** Firebase Emulator (`npx firebase emulators:start --only firestore --project demo-alama`) on `127.0.0.1:8080`. Tests load `firestore.rules` via `@firebase/rules-unit-testing`. No production credentials; no real Firebase project touched.

**Fixtures:** Schools `sch_A` (active), `sch_B` (active), `sch_suspended` (suspended); students `sA1`,`sA2` (sch_A), `sB1` (sch_B). Callers via custom claims: alice (sch_A admin), bob (sch_A teacher), carol (sch_B admin), dave (sch_A admin, inactive membership), eve (platform admin), fred (suspended-school member).

**20 test cases — ALL PASSED:**

| # | Case | Expect | Result |
|---|---|---|---|
| 1 | sch_A admin reads sch_A student | permitted | PASS |
| 1b | sch_A admin school-scoped query | permitted | PASS |
| 2 | sch_A teacher reads sch_A student | permitted | PASS |
| 3 | sch_A admin reads sch_B student | DENIED | PASS |
| 3b | sch_A query returns no sch_B docs | no leak | PASS |
| 4 | sch_A admin creates student schoolId=sch_B | DENIED | PASS |
| 5 | sch_A admin changes sA1 schoolId to sch_B | DENIED | PASS |
| 5b | sch_A admin updates sA1 non-schoolId field | permitted | PASS |
| 6 | unauthenticated reads students | DENIED | PASS |
| 6b | unauthenticated creates student | DENIED | PASS |
| 7 | sch_A admin, inactive membership, reads | DENIED | PASS |
| 8 | member of suspended school reads | DENIED | PASS |
| 8b | suspended school not operational | DENIED | PASS |
| 9 | platform admin reads sch_A student | permitted | PASS |
| 9b | platform admin reads sch_B student | permitted | PASS |
| 9c | platform admin creates sch_A record | permitted | PASS |
| 10 | sch_A admin grants self platformAdmin | DENIED | PASS |
| 10 | teacher creates student (admin-only) | DENIED | PASS |
| 10b | non-owner changes another user role | DENIED | PASS |
| 10c | unauthenticated writes | DENIED | PASS |

**Result: 20 passed, 0 failed.**

---

## 5. Student service changes (`src/db/studentService.js`)

Tenant-aware while remaining backward-compatible with existing callers (transitional — active-school wiring happens next):

- **`getStudents(filters = {})`** — accepts optional `schoolId`. When supplied, reads via `getDocs(query(collection(db,'students'), where('schoolId','==',schoolId)))` so reads never leave the active school and server rules can satisfy the query. When omitted (existing callers), falls back to the previous `getAllDocs()` behavior. All existing client-side filters (`classLevel`, `stream`, `classStream`, `status`, `curriculum`, `search`) preserved.
- **`createStudent(data)`** — injects `schoolId: data.schoolId` into the document (tenant identity). Rules require it to match `request.auth.token.schoolId`. SchoolPay import logic unchanged: doc ID = `schoolpayCode` for imports, `generateId('student')` for manual; admission-number uniqueness checked within the fetched (school-scoped) set.
- **`updateStudent(id, updates)`** — strips `schoolId` from updates so a client can never change a record's school ownership; the existing `schoolId` is preserved. All other existing behavior (schoolpayCode/source immutability, curriculum/referenceId preservation, classStream recompute) unchanged.
- **`deleteStudent(id)`** — unchanged (rules deny student deletes; deactivation via `status:'inactive'`).
- **`getStudentById` / `getStudentBySchoolpayCode`** — unchanged `safeGet` (single-doc read; rules enforce doc ownership).
- **`getStudentCount(schoolId)`** — scoped to the active school when `schoolId` supplied.

**Preserved:** SchoolPay import (`studentImportService.js` untouched, its tests pass), student deactivation (`status:'inactive'`), existing doc-ID schemes, manual vs. import source distinction.

---

## 6. Existing tests and build results

| Check | Result |
|---|---|
| `npm test` (grading, ranking, marksEntry) | ALL PASS |
| `studentImport.test.js` | ALL PASS |
| `firestoreRules.tenant.test.js` (emulator) | 20/20 PASS |
| `npm run build` (vite) | ✓ built in 2m 23s, 1554 modules transformed, no errors |
| Lint/type checks | None configured in repo (no eslint/prettier/tsconfig). Build transform acts as the syntax check. |

**Pre-existing failures:** None reported — all checks green.

---

## 7. Remaining security risks

1. **`config/` singleton docs not yet tenant-scoped.** `config/app_config`, `config/setup`, `config/grading_settings` remain top-level (one school per DB). `configService.js` was not modified this milestone. Per-school config (`schools/{schoolId}/config/...`) deferred.
2. **Other academic services not yet tenant-aware.** `examService`, `classService`, `subjectService`, `staffService`, `attendanceService`, `feeService`, `payrollService`, `exportService`, `resultsService` do not inject `schoolId` on writes or scope reads. Against these rules they would fail once connected to a tenant-enforced Firestore — handled in later phases.
3. **Custom claims must be set server-side.** No provisioning server / Admin SDK exists today, so claims (`schoolId`, `role`, `platformAdmin`, …) cannot be issued in production yet. Rules cannot fully operate until server-side provisioning exists.
4. **AuthContext / RoleGuard not yet multi-tenant.** No active-school membership selection, no claim refresh (`getIdToken(true)`), no per-school role resolution. `RoleGuard` uses a global `user.role`.
5. **Existing callers don't pass `schoolId`.** `Students.jsx`, `ImportStudents.jsx`, `Dashboard.jsx`, etc. call `getStudents()` without `schoolId`. Once these rules are enforced against real data, unfiltered reads are rejected by Firestore — transitional until AuthContext wiring passes the active school.
6. **Offline cache not cleared on school switch.** `persistentLocalCache` may retain a previous tenant's data in IndexedDB.
7. **Document ID collisions across tenants.** `schoolpayCode`, `result_{examId}_{studentId}`, counters (`ADM{n}`, etc.) can collide in a shared DB. Rules prevent cross-tenant overwrite via `schoolId`, but IDs should be prefixed/regenerated at migration.

---

## 8. Exact recommended next implementation task

Do not proceed without approval. The immediate next step is:

**Wire the active school into the client and stand up server-side claim provisioning, then extend `schoolId` enforcement to one more service.**

Concretely:
1. **Server-side provisioning endpoint (Admin SDK):** `provisionSchool(schoolData, adminEmail)` — creates `schools/{schoolId}`, the first-admin `users/{uid}` profile with membership, and sets Firebase Auth custom claims (`schoolId`, `schoolIds`, `role`, `membershipActive`, `active`, `platformAdmin`). Self-service registration must be server-mediated (no client school creation).
2. **AuthContext:** after login, load memberships; select an active school (auto-select when one membership); refresh claims via `firebaseUser.getIdToken(true)`; expose `activeSchoolId` and per-school role.
3. **Update `studentService.js` callers** (`Students.jsx`, `ImportStudents.jsx`, `Dashboard.jsx`, `Attendance.jsx`, `Exams.jsx`, `ProjectWork.jsx`, `Fees.jsx`, `resultsService.js`, `exportService.js`) to pass the active `schoolId` so reads are scoped and writes inject it.
4. **Then** extend `schoolId` enforcement to `examService.js` / `exam_results` as the next proving-ground service, followed by the remaining academic services per the dependency map in the assessment (§7).

Stop here. Awaiting approval before any further implementation.
