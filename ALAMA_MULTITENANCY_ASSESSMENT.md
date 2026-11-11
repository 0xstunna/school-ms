# Alama — SaaS Architecture Readiness Assessment

**Status:** READ-ONLY assessment. No source files, data, or Firebase resources were modified, created, deleted, or migrated.
**Product:** Alama — academic management SaaS for Ugandan secondary schools (S1–S6), web + Electron (desktop).
**Scope honored:** Academic management only. UCE + NLSC grading preserved. Historical examination results preserved. SchoolPay import preserved. Offline-first preserved where technically safe. No fees/payroll/expenses/net-new modules introduced.

---

## 1. Executive Summary

Alama is currently a **single-school, single-Firebase-project application**. Every architectural assumption ties one Firebase project to one school:

- `src/db/firebase.js` initializes exactly one Firebase app from one `firebaseConfig` (one `projectId`).
- `config/app_config` is a **singleton** school-profile document (one school per database).
- `config/setup` is a **singleton** first-admin guard flag (one first admin per database).
- **Zero** references to `schoolId`, `tenant`, `organisation`, or `organization` exist anywhere in `src/` (confirmed by grep).
- **Every** data service reads entire collections via `getAllDocs()` — there is no server-side tenant filter, and Firestore security rules contain no tenant checks.

**Principal risk:** If multiple schools' data were ever loaded into one Firestore project/database (the necessary first step toward a SaaS), any authenticated client could read **all** schools' students, marks, fees, payroll, and staff via `getAllDocs`, because `firestore.rules` authorizes purely on Firebase Auth UID + role, never on school membership. Adding a bare `schoolId` field to documents does **not** create secure multi-tenancy; it must be paired with auth claims + rule enforcement + query scoping.

**Recommended direction:** One shared Firebase project for the platform, a `schools` tenant root, a `schoolId` on every academic document, Firebase Auth custom claims carrying each user's active school(s) and roles, Firestore rules that enforce `schoolId == auth.token.schoolId`, server-side provisioning for self-service registration, and Firestore persistent cache retained for offline-first behavior scoped to the active school.

---

## 2. Current Architecture Map

### 2.1 Stack and topology

| Layer | Technology | Location |
|-------|-----------|----------|
| UI framework | React 18 + React Router DOM 6 | `src/` |
| Build tool | Vite 5 | `vite.config.js` |
| Styling | TailwindCSS 3 | `tailwind.config.js` |
| Auth | Firebase Auth (email/password only) | `src/db/firebase.js`, `src/db/userService.js` |
| Database | Firestore (native mode) + persistent local cache (IndexedDB) | `src/db/firebase.js` lines 50-54 |
| File storage | Firebase Storage (initialized, **not used** by any service) | `src/db/firebase.js` line 49 |
| Desktop | Electron 28 + electron-builder | `electron/main.js`, `electron/preload.js`, `package.json` |
| Hosting option | Vercel (static build) | `vercel.json` |
| Offline | Firestore `persistentLocalCache({ tabManager: persistentSingleTabManager() })` | `src/db/firebase.js` lines 51-54 |

**No backend server exists today.** The browser/Electron renderer talks directly to Firebase (client-side SDK). There is no Cloud Functions, no Admin SDK, no API server, and no server-side validation of academic writes.

### 2.2 Authentication and user identity model

- **Provider:** Firebase Auth email/password only. `SETUP.md` §4: "The app signs users in with email + password only. No other providers are required."
- **Auth instance:** one `getAuth(appInstance)` from the single Firebase app (`src/db/firebase.js` line 48).
- **Session persistence:** Firebase Auth persists automatically across restarts; `AuthContext` listens via `onAuthStateChanged` (`src/contexts/AuthContext.jsx` lines 12-37).
- **User profile:** stored in Firestore `users/{uid}`:
  ```
  { type:'user', uid, fullName, email, role:'admin'|'teacher'|'bursar',
    active: boolean, assignedClasses: [], createdBy, createdAt, updatedAt }
  ```
  (`src/db/userService.js` lines 73-84, 112-123)
- **Roles:** exactly three — `admin`, `teacher`, `bursar` (`src/utils/constants.js` lines 8-12). `validRole()` in rules restricts to these three (`firestore.rules` lines 39-41).
- **First admin:** `createFirstAdmin()` creates the Firebase Auth account **and** writes the `users/{uid}` profile **and** `config/setup` in one write batch, with **no prior auth session** (`src/db/userService.js` lines 46-97; invoked by `SetupWizard` line 77).
- **Admin-created accounts:** `createUser()` uses a **temporary secondary Firebase App instance** (`initializeApp(appConfig, 'sms_tmp_...')`) so the signed-in admin is not signed out (`src/db/userService.js` lines 31-40, 103-127; documented in `SETUP.md` §"Admin-created teacher accounts do NOT sign the admin out").
- **Password change:** `changeOwnPassword()` re-authenticates with current password then updates (`src/db/userService.js` lines 172-182).
- **Deactivation:** `active: false` on the Firestore profile; `AuthContext` signs out deactivated users on next profile load (`src/contexts/AuthContext.jsx` lines 18-25).
- **Email uniqueness:** enforced per Firebase project only. `getUserByEmail()` scans **all** `users/` docs client-side (`src/db/userService.js` lines 136-142).
- **No password reset flow in UI:** documented in `ADMIN_GUIDE.md` §8 (admins directed to Firebase Console).

### 2.3 Role enforcement (two layers, neither tenant-aware)

| Layer | Mechanism | Location | Tenant-aware? |
|-------|-----------|----------|---------------|
| Client UI | `RoleGuard` + `hasRole()` from AuthContext | `src/guards/RoleGuard.jsx`, `src/contexts/AuthContext.jsx` lines 70-73 | No |
| Client UI | Feature flags + `ROLES` in nav items | `src/utils/featureFlags.js`, `src/utils/constants.js` lines 58-166 | No |
| Server (Firestore) | `hasRole(role)` checks `users/{auth.uid}.data.role` + `active` | `firestore.rules` lines 22-36 | No |

### 2.4 Offline persistence and synchronization

- Firestore `persistentLocalCache` with `persistentSingleTabManager()` (`src/db/firebase.js` lines 51-54). Reads/writes hit the IndexedDB cache; the SDK auto-syncs on reconnect.
- **No** explicit network-status listener, **no** offline write queue, **no** conflict resolution, **no** operation replay, **no** selective cache invalidation when switching schools.
- `SETUP.md` §"How offline mode works": "Reads/writes use the local IndexedDB cache … Local changes automatically sync to Firebase. No special setup needed."

### 2.5 Electron and web application configuration

- `electron/main.js`: creates a `BrowserWindow`, loads `http://localhost:5173` in dev or `dist/index.html` in production. `sandbox: false`, `contextIsolation: true`, `nodeIntegration: false`.
- `electron/preload.js`: exposes only `platform` and `getVersion`/`getPlatform` via `contextBridge` (`electronAPI`). No Firebase IPC, no tenant IPC.
- `package.json` `"main": "electron/main.js"`; `"dev"` runs `concurrently "vite" "electron ."`.
- CSP in `index.html` line 6 allows `connect-src` to `https://*.googleapis.com https://*.firebaseio.com https://*.firebase.google.com wss://*.firebaseio.com` — single-project Firebase endpoints.
- Vercel build: `vite build`, output `dist`, SPA rewrite (`vercel.json`). `.env` supplies `VITE_FIREBASE_*` values (`.env` is gitignored but present on disk with real credentials for project `school-ms-16e28`).

### 2.6 Setup wizard and first-admin creation

`src/pages/setup/SetupWizard.jsx`:
- Step 1: School profile (name, motto, address, phone, email, academicYear, currentTerm).
- Step 2: Admin account (full name, email, password ≥ 8 chars).
- Calls `createFirstAdmin(adminData)` then `createConfig(schoolData)` (`src/pages/setup/SetupWizard.jsx` lines 77-78).
- `isSetupComplete()` reads `config/setup` **without authentication** (rules allow public read for cold-boot check) (`src/db/configService.js` lines 14-17; `firestore.rules` line 73).
- `App.jsx` calls `isSetupComplete()` on cold boot before sign-in (`src/App.jsx` lines 76-101); if false, shows SetupWizard; if true, shows Login.

### 2.7 School configuration and academic settings

- `config/app_config` singleton: `schoolName, schoolMotto, schoolAddress, schoolPhone, schoolEmail, academicYear, currentTerm, logoUrl (base64), createdAt, updatedAt` (`src/db/configService.js` lines 37-48).
- Logo: compressed client-side to ≤300px, stored as base64 data URL in `config/app_config.logoUrl` (`src/lib/imageUtils.js`; `src/components/common/SchoolLogoUpload.jsx`).
- `config/grading_settings` singleton: NLSC `caWeight, examWeight, certificateRule, gradeBands[]` (`src/db/gradingSettingsService.js` lines 38-56).
- `classes/{id}` singleton per class/year: `assessmentMode ('LEGACY'|'NLSC'), streams[]`; id = `class_{classLevel}_{academicYear}` (`src/db/classService.js` lines 28-56).
- Grading mode resolution: stored `assessmentMode` wins; else year-based rule (current-year S1–S4 → NLSC, else LEGACY) (`src/gradingSystems/index.js` lines 46-57).
- Academic year: single years from 2026 (`src/utils/grading.js` lines 45-52). Note: migration script and tests use `YYYY/YYYY` ranges while `generateAcademicYears()` emits single years — an internal inconsistency worth noting but out of scope.

### 2.8 Existing tests and migration utilities

- Tests (pure Node, no Firebase): `src/services/__tests__/grading.test.js`, `ranking.test.js`, `marksEntry.test.js`, `studentImport.test.js`. Run via `npm test`.
- Migration script: `src/scripts/migrateAssessmentMode.js` — dry-run by default, `--write` applies `assessmentMode` to `classes/` docs and seeds `config/grading_settings`. Backs up collections to `backups/migrate-<ts>/` before writing. **References a `gradingSettings` collection that does not exist** (actual doc is `config/grading_settings`) — line 80 `COLLECTIONS_TO_BACKUP` and line 338 read `getAllDocs('config')` then match `id === 'grading_settings'`.
- Verification script: `src/scripts/gradingVerification.js` — read-only synthetic NLSC calculation.
- No Firebase Emulator configuration, no rules unit tests, no integration tests.

---

## 3. Complete List of Collections and Affected Services

### 3.1 Firestore collections and document structure

All reads in every service use `getAllDocs(col)` → `getDocs(collection(db, col))` which fetches **every document in the collection** (`src/db/firebase.js` lines 77-81). There are no queries with `where()` filters on tenant, no indexes, no pagination.

| # | Collection / doc | Document ID convention | Shape (key fields) | Service file |
|---|------------------|------------------------|--------------------|--------------|
| 1 | `config/app_config` (singleton) | `app_config` | `type:'config', schoolName, schoolMotto, schoolAddress, schoolPhone, schoolEmail, academicYear, currentTerm, logoUrl(base64), createdAt, updatedAt` | `src/db/configService.js` |
| 2 | `config/setup` (singleton) | `setup` | `type:'setup', setupComplete:true, createdBy, createdAt, updatedAt` | `src/db/userService.js` (createFirstAdmin), `src/db/configService.js` |
| 3 | `config/grading_settings` (singleton) | `grading_settings` | `type:'grading_settings', version, caWeight, examWeight, certificateRule, gradeBands[{letter,min,descriptor,note}], updatedAt, updatedBy` | `src/db/gradingSettingsService.js` |
| 4 | `users/{uid}` | Firebase Auth UID | `type:'user', uid, fullName, email, role, active, assignedClasses[], createdBy, createdAt, updatedAt` | `src/db/userService.js` |
| 5 | `students/{id}` | `schoolpayCode` for imports; `generateId('student')` for manual | `type:'student', schoolpayCode, source, admissionNumber, fullName, dateOfBirth, gender, classLevel, stream, classStream, guardianName/Phone/Relationship, status, enrollmentDate, notes, curriculum, referenceId` | `src/db/studentService.js` |
| 6 | `exams/{id}` | `generateId('exam')` | `type:'exam', name, examType, classLevel, classStream, subjectId, subjectName, academicYear, term, date, outOf, createdBy` | `src/db/examService.js` |
| 7 | `exam_results/{id}` | `result_{examId}_{studentId}` | `type:'exam_result', examId, studentId, marks, outOf, percentage, grade, points, remarks, recordedBy` | `src/db/examService.js` |
| 8 | `projectWork/{id}` | `pw_{studentId}_{year}_{rand8}` | `type:'project_work', studentId, year, title, subjectOrArea, achievementLevel, assessorId, notes, createdAt, updatedAt` | `src/db/projectWorkService.js` |
| 9 | `classes/{id}` | `class_{classLevel}_{academicYear}` | `type:'class', classLevel, academicYear, assessmentMode, streams[], updatedAt` | `src/db/classService.js` |
| 10 | `subjects/{id}` | `generateId('subject')` | `type:'subject', name, code, applicableClasses[], outOf` | `src/db/subjectService.js` |
| 11 | `staff/{id}` | `generateId('staff')` | `type:'staff', staffNumber, fullName, email, phone, position, department, salary, userId, status, joinDate, notes` | `src/db/staffService.js` |
| 12 | `attendance/{id}` | `att_{date}_{classStream}` | `type:'attendance_session', date, classStream, academicYear, term, records[{studentId,studentName,status}], markedBy` | `src/db/attendanceService.js` |
| 13 | `fee_structures/{id}` | `feestructure_{classLevel}_{year}_{term}` | `type:'fee_structure', classLevel, academicYear, term, items[], totalAmount` | `src/db/feeService.js` |
| 14 | `fee_payments/{id}` | `generateId('feepayment')` | `type:'fee_payment', studentId, academicYear, term, amountPaid, receiptNumber, paymentMethod, paidBy, notes, paymentDate, recordedBy` | `src/db/feeService.js` |
| 15 | `payroll/{id}` | `generateId('payroll')` | `type:'payroll_entry', staffId, staffName, academicYear, term, month, basicSalary, allowances, deductions, netSalary, paymentDate, paymentMethod, notes, recordedBy` | `src/db/payrollService.js` |
| 16 | `expenses/{id}` | `generateId('expense')` | `type:'expense', category, description, amount, date, academicYear, term, notes, recordedBy` | `src/db/payrollService.js` |

### 3.2 Services inventory (all read/write academic data)

| Service file | Collections touched | Tenant filter? |
|---|---|---|
| `src/db/firebase.js` | generic helpers (`getAllDocs`, `safeGet`, `setDocument`, `addDocument`, `updateDocument`, `deleteDocument`) | No — no concept of tenant |
| `src/db/userService.js` | `users` | No — `getAllDocs('users')` for email lookup |
| `src/db/configService.js` | `config` (app_config, setup, grading_settings) | No — singleton docs |
| `src/db/studentService.js` | `students` | No — reads all students |
| `src/db/examService.js` | `exams`, `exam_results` | No — reads all |
| `src/db/projectWorkService.js` | `projectWork` | No — reads all |
| `src/db/classService.js` | `classes` | No — reads all |
| `src/db/subjectService.js` | `subjects` | No — reads all |
| `src/db/staffService.js` | `staff` | No — reads all |
| `src/db/attendanceService.js` | `attendance` | No — reads all |
| `src/db/feeService.js` | `fee_structures`, `fee_payments` | No — reads all |
| `src/db/payrollService.js` | `payroll`, `expenses` | No — reads all |
| `src/db/gradingSettingsService.js` | `config/grading_settings` | No — singleton |
| `src/db/reportCardService.js` | delegates to `computeResultsForClass` (reads students, exams, exam_results, classes, config, grading_settings) | No |
| `src/db/exportService.js` | `students, exams, exam_results, projectWork, classes, config` | No — reads all |
| `src/db/studentImportService.js` | `students` (batched merge writes) + `config` | No |
| `src/services/resultsService.js` | `exams, exam_results, students, classes, config, grading_settings` | No — aggregation across everything |
| `src/scripts/migrateAssessmentMode.js` | `students, classes, exams, exam_results, config, gradingSettings(nonexistent), projectWork` | No |
| `src/App.jsx` + pages | all of the above via services | No |

**Key evidence:** 14 of 16 collections are read wholesale by at least one service (`grep getAllDocs|collection(` over `src/db` returned 40 matches across all services). Not one call passes a tenant predicate.

### 3.3 Pages and components that consume the data

| Page/component | Data used | Route guard |
|---|---|---|
| `src/pages/auth/Login.jsx` | Firebase Auth sign-in; `config` for school name | none (pre-auth) |
| `src/pages/setup/SetupWizard.jsx` | `config/setup`, `config/app_config`, `users` (first admin) | none (pre-setup) |
| `src/pages/dashboard/Dashboard.jsx` | `config`, student/staff/fee/attendance counts | none (layout-level) |
| `src/pages/students/Students.jsx` | `students`, `config` | `['admin','teacher']` |
| `src/pages/students/ImportStudents.jsx` | `students` (SchoolPay import), `config` | `['admin']` |
| `src/pages/exams/Exams.jsx` | `exams, exam_results, students, subjects, projectWork, config` | `['admin','teacher']` |
| `src/pages/fees/Fees.jsx` | `students, fee_structures, fee_payments, config` | `['admin','bursar']` |
| `src/pages/staff/Staff.jsx` (Staff, Payroll, Expenses, Settings) | `staff, payroll, expenses, config, grading_settings` + export | `['admin']` / `['admin','bursar']` |
| `src/pages/settings/Subjects.jsx` | `subjects` | `['admin']` |
| `src/pages/projectWork/ProjectWork.jsx` | `projectWork, students` | `['admin','teacher']` |
| `src/pages/attendance/Attendance.jsx` | `attendance, students, config` | `['admin','teacher']` |
| `src/pages/users/UserManagement.jsx` | `users` | `['admin']` |
| `src/components/layout/Sidebar.jsx`, `Topbar.jsx` | `user.role` for nav rendering | — |

---

## 4. Tenant-Isolation Risk Assessment

### Finding 4.1 — Zero tenant concept exists anywhere (CRITICAL)

**Evidence:** `grep schoolId|tenant|organisation|organization` over `src/` returned **no matches**. No document, service, rule, UI component, or script references a tenant/school identifier.

**Risk:** In a shared SaaS Firestore database there is no way to distinguish School A's data from School B's. Every document is indistinguishable by ownership.

### Finding 4.2 — Every service reads entire collections unfiltered (CRITICAL)

**Evidence:** `src/db/firebase.js` `getAllDocs()`:
```js
export const getAllDocs = async (col) => {
  requireDb();
  const snap = await getDocs(collection(db, col));   // NO where() filter
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};
```
All 14 academic services call this (`students`, `exams`, `exam_results`, `projectWork`, `classes`, `subjects`, `staff`, `attendance`, `fee_structures`, `fee_payments`, `payroll`, `expenses`, `users`, `config`).

**Risk:** A teacher in School A who is signed in can call `getStudents()` and receive School B's students. `exam_results`, `fee_payments`, `payroll`, and `expenses` include financial and assessment data — a serious confidentiality breach.

### Finding 4.3 — Firestore rules authorize on UID + role only, never on school (CRITICAL)

**Evidence:** `firestore.rules`:
- `callerProfile()` reads `users/{request.auth.uid}` (line 16) — profile has `role`, `active`, `assignedClasses` but **no school**.
- `hasRole(role)` (lines 22-27) checks only `active == true` and `role == role`.
- Every academic match (`students`, `exams`, `exam_results`, `projectWork`, `attendance`, `fee_structures`, `fee_payments`, `payroll`, `expenses`, `classes`, `subjects`, `staff`) permits read/write to any signed-in staff member with the right role, regardless of which school owns the document.
- `config/setup` and `config/app_config` are publicly readable (line 73) — school identity exposed unsigned.
- Default deny (lines 184-186) only protects collections not listed.

**Risk:** Role-based rules cannot enforce "a user only sees their own school's data" because no school dimension exists in rules or data.

### Finding 4.4 — Singleton config documents assume one school per database (HIGH)

**Evidence:**
- `config/app_config` is a single doc holding one school's name, year, term, logo (`src/db/configService.js` lines 32-51).
- `config/setup` is a single flag that gates the Setup Wizard for the entire database (`src/db/configService.js` line 14, `firestore.rules` lines 45-51).
- `config/grading_settings` is a single doc (`src/db/gradingSettingsService.js` line 32).

**Risk:** Two schools cannot share a database without either (a) each getting their own Firebase project (current model — not SaaS) or (b) restructuring config into per-school documents.

### Finding 4.5 — Document ID schemes collide across schools in a shared database (HIGH)

**Evidence:**
- `students` doc ID = `schoolpayCode` for imports (`src/db/studentService.js` lines 48-56) — two schools using the same SchoolPay code range collide.
- `exam_results` id = `result_{examId}_{studentId}` (`src/db/examService.js` line 57).
- `attendance` id = `att_{date}_{classStream}` (`src/db/attendanceService.js` line 5).
- `classes` id = `class_{classLevel}_{academicYear}` (`src/db/classService.js` line 28).
- `fee_structures` id = `feestructure_{classLevel}_{year}_{term}` (`src/db/feeService.js` line 18).
- Counters: admissionNumber `ADM{count+1}` (`studentService.js` line 36), receiptNumber `RCP{count+1}` (`feeService.js` line 47), staffNumber `STF{count+1}` (`staffService.js` line 21) — all derived from local collection counts, meaningless across tenants.

**Risk:** In one shared Firestore database, writes from School B can overwrite School A's documents when IDs collide.

### Finding 4.6 — Firebase Auth is per-project; email uniqueness is per-project (HIGH)

**Evidence:** One `firebaseConfig`/`projectId` (`src/db/firebase.js` lines 24-31). `createUser()` creates Auth accounts in that one project (`src/db/userService.js` lines 109-125). `auth/email-already-in-use` recovery in `createFirstAdmin` assumes one project (`src/db/userService.js` lines 58-60).

**Risk:** The same teacher email cannot exist in two schools under one project without collision; the current per-school-project model would require users to maintain separate Auth accounts per school.

### Finding 4.7 — Client-side role guards are the only UI enforcement (MEDIUM)

**Evidence:** `RoleGuard` (`src/guards/RoleGuard.jsx`) and feature flags (`src/utils/featureFlags.js`) run in the browser. Firestore rules are the only server enforcement, and they lack tenant checks (Finding 4.3).

**Risk:** A malicious client can bypass UI guards; without server-side tenant enforcement there is no real access control.

### Finding 4.8 — Setup wizard creates school + admin in one unguarded client flow (MEDIUM)

**Evidence:** `SetupWizard.handleNext` calls `createFirstAdmin` then `createConfig` directly from the client (`src/pages/setup/SetupWizard.jsx` lines 64-79). `config/setup` can be created by any signed-in user while `setupNotDone()` (rules line 56-61). No server invitation, no school slug reservation, no payment/plan stage.

**Risk:** Self-service SaaS onboarding cannot be safely delegated fully to the client; school creation must be server-mediated to prevent name squatting, duplicate schools, and unauthorized tenant creation.

### Finding 4.9 — No offline/sync tenant scoping (MEDIUM)

**Evidence:** `persistentLocalCache` caches everything fetched (`src/db/firebase.js` lines 51-54). No logic clears the cache on logout or school switch; no write queue; no conflict resolution.

**Risk:** When a user switches between schools (SaaS multi-tenancy) the local cache may retain School A's data while the user works in School B, causing cross-tenant reads from cache and stale sync.

### Finding 4.10 — Real Firebase credentials committed to disk (LOW, operational)

**Evidence:** `.env` (gitignored) contains live values for project `school-ms-16e28` (apiKey, authDomain, projectId, etc.). `.gitignore` lists `.env`, so it is not tracked, but it exists on developer machines.

**Risk:** Accidental exposure of a development Firebase project. Not a multi-tenancy code defect, but relevant to provisioning design (the SaaS needs its own project, separate from per-school dev projects).

---

## 5. Recommended Target Architecture

### Principle (from constraints)

> Never assume that adding a `schoolId` field alone creates secure multi-tenancy.

Secure multi-tenancy requires **all four** of: (1) `schoolId` on every academic document, (2) authenticated identity that carries school membership (e.g., Firebase Auth custom claims), (3) Firestore rules that compare document `schoolId` against the caller's claims and scope queries, and (4) client code that always includes `schoolId` in queries/writes and never trusts the client-chosen value.

### 5.1 Tenant-aware data model

Introduce a `schools` tenant root. Every existing collection gains a `schoolId` field. Two layout options are presented; **Option A (top-level collections + schoolId)** is recommended as the minimal, lowest-risk migration path because it preserves existing collection names, document IDs, service signatures, and query code as much as possible.

**Option A — top-level collections with `schoolId` (recommended for migration)**

```
schools/{schoolId}                              NEW — tenant root
  { type:'school', schoolName, schoolMotto, schoolAddress,
    schoolPhone, schoolEmail, academicYear, currentTerm, logoUrl,
    plan: 'trial'|'starter'|'school', status: 'active'|'suspended'|'closed',
    subscriptionId, currentPeriodEnd, createdAt, updatedAt }

users/{uid}                                     EXISTING + schoolId/schoolIds
  { type:'user', uid, fullName, email, schoolId (active school),
    schoolIds: [...], roles: { [schoolId]: ['admin'] }, active, ... }

students/{id}                                   EXISTING + schoolId
  { ..., schoolId, schoolpayCode, source, ... }
exams/{id}                                      EXISTING + schoolId
exam_results/{id}                               EXISTING + schoolId
projectWork/{id}                                EXISTING + schoolId
classes/{id}                                    EXISTING + schoolId
subjects/{id}                                   EXISTING + schoolId
staff/{id}                                      EXISTING + schoolId
attendance/{id}                                 EXISTING + schoolId
fee_structures/{id}                             EXISTING + schoolId
fee_payments/{id}                               EXISTING + schoolId
payroll/{id}                                    EXISTING + schoolId
expenses/{id}                                   EXISTING + schoolId

schools/{schoolId}/config/{setup|app_config|grading_settings}
                                                NEW — per-school config subcollection (or keep top-level config docs with schoolId field)
```

**Option B — subcollection per school** (`schools/{schoolId}/students`, etc.)

- Cleaner isolation at the data-model level.
- **Not recommended as the first step:** it requires rewriting every service (`collection(db, 'students')` → `collection(db, 'schools', schoolId, 'students')`), changes all document ID conventions, invalidates existing IDs (marks reference student doc IDs), and complicates offline cache management. Reconsider in a later major version if cross-school queries (platform-wide analytics) are needed.

**Retained semantics:**
- Historical `exam_results` are never rewritten — `schoolId` is **added**, marks/grades/outOf untouched.
- UCE/NLSC dual grading preserved: `classes.assessmentMode` and `config/grading_settings` become per-school (with `schoolId`).
- SchoolPay import preserved: `students` doc ID stays `schoolpayCode`; uniqueness now scoped by `schoolId` in rules.
- `fee_structures`, `fee_payments`, `payroll`, `expenses` remain in scope (already in codebase, feature-flag hidden) and gain `schoolId` like everything else.

### 5.2 School membership and role architecture

**Identity vs membership split:**
- **Firebase Auth user** = platform-global identity (email, password, one account a person can use across schools).
- **School membership** = link between a user and a school, with roles for that school. Stored in Firestore `schoolMemberships/{membershipId}` or embedded as `schoolIds[]`/`roles` on the user doc.

Recommended shape on the `users/{uid}` doc (simplest, keeps existing service surface):
```js
{
  type:'user', uid, fullName, email,
  schoolId: 'sch_...',                 // active school context (client-selected)
  schoolIds: ['sch_A', 'sch_B'],       // all schools the user belongs to
  roles: { 'sch_A': ['admin'], 'sch_B': ['teacher'] },
  active: true, assignedClasses: [], ...
}
```

- A user signs in once to the platform. On login, the client loads the profile and lets the user pick an active school (or auto-selects if only one).
- Role for the current route = `roles[activeSchoolId]`. `RoleGuard` checks membership in the active school, not a global role.
- **Platform administrator:** separate boolean `platformAdmin` on the user doc (or a `platformAdmins` collection). Platform admins can provision/suspend schools but do not automatically get school-admin academic access unless granted a membership.

**Firebase Auth custom claims** (set via Admin SDK on provisioning and on membership change):
```js
{
  schoolId: 'sch_A',          // active school at token-issuance time
  schoolIds: ['sch_A','sch_B'],
  roles: { sch_A: ['admin'] },
  platformAdmin: false
}
```
Firestore rules read `request.auth.token.schoolId` / `request.auth.token.schoolIds` / `request.auth.token.platformAdmin`. Claims are refreshed by calling `firebaseUser.getIdToken(true)` after membership changes.

### 5.3 Secure tenant isolation (rules design)

**Core rule pattern** for every academic collection:
```js
function tenantId() { return request.auth.token.schoolId; }
function tenantIds() { return request.auth.token.schoolIds || []; }
function isPlatformAdmin() { return request.auth.token.platformAdmin == true; }

// READ: caller's active school must own the doc (or platform admin)
allow read: if isSignedIn() && isActiveStaff()
  && (resource.data.schoolId == tenantId()
      || isPlatformAdmin()
      || (tenantIds().hasAny([resource.data.schoolId])));
```

**Write rules:**
- `schoolId` is **immutable**: `request.resource.data.schoolId == resource.data.schoolId` on update; on create, `request.resource.data.schoolId == tenantId()` (client cannot write another tenant's ID).
- Role checks preserved per collection (admin/teacher/bursar) AND scoped to active school.
- `config/setup` → per-school `schools/{schoolId}/config/setup`, gated so setup can run once per school.
- Default deny (`match /{document=**} { allow read, write: if false; }`).

**Query scoping:** every service query must add `where('schoolId', '==', activeSchoolId)`. Firestore enforces that queries match rule predicates; a query without the `schoolId` filter is rejected by rules (rules-based query filtering).

**What `schoolId` alone does NOT do (per constraints):** it does not stop a client from writing `{ schoolId: 'otherSchool' }` unless rules reject it; it does not stop reading all docs unless rules filter by `auth.token.schoolId`; it does not stop ID-guessing. Claims + rules + query scoping are all required.

### 5.4 Server-side school provisioning

No server exists today. Introduce a minimal server-side component (Node.js + Firebase Admin SDK) — deployable as Cloud Functions for Firebase, or a lightweight container/HTTPS endpoint on the platform's hosting.

**Provisioning flow `provisionSchool(schoolData, adminEmail)`:**
1. Validate school name/email uniqueness (platform-level `schools` collection + check Auth email).
2. Create `schools/{schoolId}` doc (status `trial` or `active`, plan `starter`, timestamps).
3. Create or link the first admin's Firebase Auth account (invitation flow: generate temp password or send email-verification invite; **do not migrate raw passwords** from old projects).
4. Create the admin's `users/{uid}` profile with `schoolId`, `roles: { [schoolId]: ['admin'] }`, and set custom claims.
5. Create per-school `config/setup` (pending), seed `config/grading_settings` placeholders ("VERIFY WITH UNEB"), seed default `classes`/`subjects` structure if desired.
6. Return `{ schoolId, adminEmail, loginUrl }`.

**Self-service registration endpoint** (public, rate-limited):
- Inputs: school name, admin email, admin password, preferred subdomain/slug.
- Server validates slug uniqueness, creates the tenant, returns credentials.
- Client is redirected to the Setup Wizard **scoped to `schoolId`** (via route param or state): the wizard pre-fills school name and creates/completes the per-school `config/app_config`, then marks `config/setup` complete for that school.

**Admin-created teacher accounts (multi-tenant):**
- `createUser(email, role, schoolId)` now runs server-side (or via a callable function) using Admin SDK `createUser()`, then writes `users/{uid}` with `schoolId` and membership roles. The temporary-secondary-app workaround (`src/db/userService.js` lines 31-40) is no longer needed because server creation never touches the signed-in admin's client Auth session.

### 5.5 Self-service registration and onboarding (preserved UX)

The existing Setup Wizard UX is preserved but re-scoped:

1. **Marketing/registration page (new):** school registers → server provisions tenant → email sent to admin with login link.
2. **Login (existing `Login.jsx`):** authenticates against the **single platform Firebase project**; after sign-in, loads user profile + memberships.
3. **School selector (new):** if user belongs to >1 school, choose active school; token claims updated.
4. **Setup Wizard (existing, modified):** `createFirstAdmin` and `createConfig` now target `schools/{schoolId}/...`; `isSetupComplete()` reads `schools/{schoolId}/config/setup`. Wizard never runs twice for the same school.
5. **Dashboard:** `config` read is now `schools/{schoolId}/config/app_config`; school name chip in Topbar reflects the active tenant.

### 5.6 Platform administrator capabilities

- New role `platformAdmin` (distinct from school `admin`).
- Web UI (admin-only route): list schools, suspend/reactivate, change plan, view provisioning date.
- Can create school memberships for support staff.
- **Cannot** read/modify a school's academic data unless explicitly granted a membership in that school (least privilege; avoids platform-admin blanket access to student marks).
- Subscription/plan data lives on `schools/{schoolId}.plan` and `.status` — no billing code yet (see §5.10).

### 5.7 Web and Electron authentication against one SaaS backend

- **One Firebase project for the platform** (replace the per-school `firebaseConfig` model from `SETUP.md`).
- `src/db/firebase.js` reads a single platform `firebaseConfig` (env `VITE_FIREBASE_*`); no per-install Firebase Console project.
- `AuthContext.login(email, password)` unchanged API; after sign-in it fetches the profile (now with `schoolIds`/`roles`) and derives the active school.
- Electron: same auth flow in the renderer; `localhost` and the production domain are both authorized Firebase Auth domains (single domain to add to Firebase Console Authorized Domains).
- `electron/preload.js` remains a thin bridge; no Firebase IPC needed. If Electron-specific capabilities (print, auto-updater) are required later, expose via IPC — out of scope.
- `index.html` CSP `connect-src` updated to the single platform project's `*.firebaseio.com` / `firebase.google.com` endpoints.

### 5.8 Offline synchronization strategy

Preserve Firestore's `persistentLocalCache` (offline-first). Add tenant scoping:

1. **Cache only the active school's data:** service queries add `where('schoolId', '==', activeSchoolId)`, so the IndexedDB cache holds only the current tenant.
2. **On sign-in / school switch / sign-out:** clear Firestore persistence for the previous tenant (`clearIndexedDbPersistence()` / terminate and re-initialize Firestore with the new school context) so no cross-tenant data lingers in IndexedDB.
3. **Offline writes:** client writes include `schoolId` (from claims); rules validate `schoolId == auth.token.schoolId`. On reconnect, the SDK syncs pending writes to the server — same as today, but now tenant-scoped.
4. **Conflict resolution:** keep Firebase SDK default last-write-wins; add `updatedAt` on every doc (already done) so clients can detect overlaps. For marks (`exam_results`, id `result_{examId}_{studentId}`) the deterministic ID means re-saving overwrites — preserved behavior, now per-school.
5. **Network status:** add `onSnapshot` listeners with error handling / `firebase.auth().onAuthStateChanged` and `connectivity` monitoring so the UI shows online/offline and can flush queues. (Existing code has none — new but additive.)

### 5.9 Migration strategy for existing school installations

Each existing school runs its own Firebase project (e.g., the `.env` project `school-ms-16e28`). Migration moves one school into one tenant in the shared SaaS project.

**Per-school migration steps:**
1. **Export** the old project's data (existing `exportData()` or Admin SDK backup): `students`, `exams`, `exam_results`, `projectWork`, `classes`, `subjects`, `staff`, `attendance`, `fee_structures`, `fee_payments`, `payroll`, `expenses`, `config/app_config`, `config/grading_settings`. **Do NOT export `users/`** (auth data — passwords cannot be exported).
2. **Provision** the tenant server-side (`provisionSchool`), creating `schools/{schoolId}` and the first-admin membership. Invite the old admin to set a platform password (invite/password-reset flow).
3. **Transform** each document: add `schoolId`; keep existing document IDs where collision-safe (`schoolpayCode` for students is unique within the school; mark IDs deterministic). For IDs derived from collection counts (`ADM{n}`, `RCP{n}`, `STF{n}`), regenerate or prefix to avoid collisions.
4. **Backfill** `schoolId` on `config` docs and create per-school `config/setup` = complete (skip re-running the wizard; or run a lightweight confirmation step).
5. **Migrate users:** for each old `users/{uid}` profile, create a platform Auth account (invite flow), write the new `users/{uid}` with `schoolId` and `roles`. Map old roles → new roles (admin/teacher/bursar). Preserve `assignedClasses`.
6. **Dry-run first:** the migration tool (adapted from `src/scripts/migrateAssessmentMode.js`) runs in dry-run mode, printing planned transformations without writing; backs up before writing; can be re-run idempotently.
7. **Rollback:** keep the old Firebase project untouched until the school validates the new tenant (read-only parallel run).
8. **Repeat** per school installation. There is no cross-school data merge; each school is an independent tenant.

**What is preserved:** historical marks/grades (exam_results untouched), UCE + NLSC modes (classes.assessmentMode + grading_settings carried over), SchoolPay codes (students doc IDs), logo (base64 in app_config), academic year/term.

**What is not migrated (by design):** Firebase Auth passwords (invite/reset), per-project Firebase configuration (replaced by single platform config).

### 5.10 Subscription architecture (additive — not implemented yet)

Per the constraints, billing is **not** implemented now. Add only the data model and gating hooks so Stripe (or similar) can be added later without re-architecture:

- `schools/{schoolId}`: `plan: 'trial'|'starter'|'school'`, `status: 'active'|'suspended'|'past_due'|'closed'`, `subscriptionId`, `currentPeriodEnd`, `trialEndsAt`.
- Extend `featureFlags.js`-style gating: plan-based feature map (e.g., trial = 50 students, paid = unlimited) — additive wrapper around existing flags; existing `FEATURES` object unchanged.
- No fee/payroll/expense/net-new module code beyond what already exists (those collections already exist and are feature-flagged off; keep them as-is).

---

## 6. Existing Data Migration Strategy (summary)

| Step | Action | Owner | Artifact |
|------|--------|-------|----------|
| 1 | Read-only inventory of each school's existing Firestore project (all 16 collections + users) | Migration script (new) | `backup_<school>/` JSON |
| 2 | Provision tenant in SaaS project; invite admin | Server provisioning (new) | `schools/{schoolId}`, membership |
| 3 | Transform docs: add `schoolId`, keep IDs | Migration script (new) | N/A |
| 4 | Write to tenant (idempotent, dry-run first) | Migration script (new) | tenant docs |
| 5 | Create platform Auth accounts for users (invite flow) | Server + email | `users/{uid}` |
| 6 | Validate: counts, marks, grading modes, logo | QA + school admin | sign-off |
| 7 | Decommission old project after validation window | Ops | — |

Key reuse: existing `exportData()` (`src/db/exportService.js`) already exports students/exams/results/projectWork/classes/config; existing migration dry-run/backup pattern (`migrateAssessmentMode.js`) is the template.

---

## 7. Implementation Dependency Map

Order matters because later items depend on earlier ones:

```
1. Platform Firebase project + Admin SDK service (provisioning)
   └─ 2. schools collection + schoolId on all existing collections (data model)
        └─ 3. Firebase Auth custom claims (schoolId, schoolIds, roles, platformAdmin)
             └─ 4. Firestore rules rewritten for tenant isolation (schoolId == auth.token)
                  └─ 5. Server-side provisioning endpoint (self-service registration)
                       └─ 6. Client: school selector + active-school context (AuthContext)
                            └─ 7. Setup Wizard re-scoped per school (config/setup per school)
                                 └─ 8. All services: add schoolId to writes + where() to reads
                                      └─ 9. Offline cache scoping + clear-on-switch
                                           └─ 10. Migration tool + per-school migration runs
                                                └─ 11. Plan field + feature gating hooks (billing later)
                                                   └─ 12. Platform admin UI (list/suspend schools)
```

**Hard dependencies:** rules must be enforced before any multi-tenant data is written (otherwise school A's client can read school B's data immediately). Claims must exist before rules can use `auth.token.schoolId`. Service writes must inject `schoolId` before rules require it.

---

## 8. Test Strategy (with emphasis on cross-tenant access)

### 8.1 Preserve existing tests
- `src/services/__tests__/grading.test.js`, `ranking.test.js`, `marksEntry.test.js`, `studentImport.test.js` — pure unit tests; must continue to pass. Grading logic (UCE + NLSC) is untouched by multi-tenancy.

### 8.2 New unit tests
- `schoolId` injection on every service create/update (assert `data.schoolId === activeSchoolId`).
- `where('schoolId', '==', ...)` added to every `getAllDocs`/query (assert query contains school filter).
- Immutable `schoolId`: update attempts that change `schoolId` throw.
- `resolveAssessmentMode` / grading factory (unchanged, add regression cases).
- Claim parsing helper (extract active school from token).

### 8.3 Firestore rules unit tests (Firebase Emulator)
Use the Firebase Emulator + `@firebase/rules-unit-testing` (new dev dependency):
- **Cross-tenant read:** sign in as School A teacher, attempt `getDocs(students)` where a doc belongs to School B → expect `PERMISSION_DENIED` / empty result.
- **Cross-tenant write:** School A client attempts `setDoc(students, id, { schoolId: 'sch_B', ... })` → expect rejected.
- **SchoolId spoofing:** create doc with `schoolId` not matching `auth.token.schoolId` → rejected.
- **Setup isolation:** `config/setup` for school A cannot be created while it exists; school B can have its own setup.
- **Public reads:** `config/setup`/`app_config` readable unsigned (cold boot) but nothing else.
- **Role boundaries:** student write by teacher (denied), admin write (allowed within own school only), platform admin bypass (allowed across schools).

### 8.4 Integration tests (Auth + Firestore, emulator)
- Two schools, two admins, teachers in each.
- Admin A creates student; assert Admin B's `getStudents()` does not return it.
- Marks entered for School A's student are not visible to School B's teacher.
- User belonging to both schools can switch active school; claims update; data shown switches accordingly.
- Offline: write a mark while offline for School A, reconnect, assert sync; cache cleared when switching to School B.

### 8.5 Cross-tenant access test matrix (required before any tenant shares a database)

| Actor | Target | Expected |
|-------|--------|----------|
| School A teacher | School A students | ✅ allowed |
| School A teacher | School B students | ❌ denied |
| School A admin | School B exam_results | ❌ denied |
| School A admin | School B `config/app_config` | ❌ denied (unless public cold-boot doc) |
| Platform admin | any school's data | ✅ allowed (claims bypass) |
| Unsigned user | `config/setup` of any school | ✅ read (cold-boot) only |
| Unsigned user | `students` | ❌ denied |
| Any user | write `schoolId: 'other'` | ❌ denied |

### 8.6 Test environment
- Firebase Emulator for rules + Firestore integration (new).
- CI runs: unit tests (existing) + rules tests + integration tests on every PR.
- No tests may write to a real Firebase project.

---

## 9. Files and Components That Would Need Modification

**Core data layer:**
- `src/db/firebase.js` — single app init stays; add active-school context, `clearPersistence` helper for school switch, export `db` per tenant if needed.
- `src/db/userService.js` — `createUser`, `getUserByEmail`, `getUsers`, `countAdmins` scoped by school; `createFirstAdmin` takes `schoolId`.
- `src/db/configService.js` — `isSetupComplete`, `getConfig`, `createConfig`, `updateConfig` parameterized by `schoolId` (`schools/{schoolId}/config/...`).
- `src/db/studentService.js` — add `schoolId` to writes; filter reads by school.
- `src/db/examService.js` — add `schoolId` to exams/results.
- `src/db/projectWorkService.js`, `src/db/classService.js`, `src/db/subjectService.js`, `src/db/staffService.js`, `src/db/attendanceService.js`, `src/db/feeService.js`, `src/db/payrollService.js`, `src/db/gradingSettingsService.js` — same pattern.
- `src/db/reportCardService.js` / `src/services/resultsService.js` — scope all reads by active school.
- `src/db/exportService.js` / `src/db/studentImportService.js` — tenant-scoped export/import.

**Auth and context:**
- `src/contexts/AuthContext.jsx` — load memberships, active-school selection, token refresh (`getIdToken(true)`), profile shape (`schoolIds`, `roles`).
- `src/guards/RoleGuard.jsx` — check membership role for active school.
- `src/pages/auth/Login.jsx` — post-login school selector when multiple memberships.
- `src/db/firebase.js` `appConfig` export — single platform config.

**Setup and onboarding:**
- `src/pages/setup/SetupWizard.jsx` — `schoolId` scoping, `config/setup` per school, skip when already done for this school.
- `src/App.jsx` — `isSetupComplete(schoolId)`, route-level school context.
- (New) server-side provisioning endpoint (Admin SDK) — not in repo yet.
- (New) registration/landing page.

**UI/layout:**
- `src/components/layout/Sidebar.jsx`, `Topbar.jsx` — show active school; allow switching.
- `src/utils/featureFlags.js` — extend with plan-based gating hooks (additive).
- `src/pages/staff/Staff.jsx` (Settings) — `updateConfig`/`createOrUpdateGradingSettings` scoped by school; export per school.

**Scripts:**
- `src/scripts/migrateAssessmentMode.js` — template for migration tool (add `schoolId`, dry-run, backup).
- (New) migration/transform script; (new) provisioning CLI.

**Config/infra:**
- `.env.example` — single platform Firebase config (remove per-school setup instructions).
- `firestore.rules` — full rewrite for tenant isolation (claims-based).
- `SETUP.md`, `ADMIN_GUIDE.md` — documentation updates.
- `index.html` CSP — single project domain.
- `vite.config.js` — likely unchanged.

**Tests:**
- Existing 4 test files — keep passing.
- (New) rules unit tests, cross-tenant integration tests, service unit tests for `schoolId`.

**Not modified (preserved):**
- `src/gradingSystems/*` (legacyGrading, nlscGrading, factory, interface) — UCE + NLSC logic untouched.
- `src/utils/grading.js` — `getGrade`, `getDivision`, date/year helpers untouched.
- `src/lib/imageUtils.js`, `src/lib/xlsx.mjs` — logo + SchoolPay parsing untouched.
- `src/utils/printUtils.js` — report printing untouched.
- `src/components/common/*` — UI primitives untouched.
- `electron/main.js`, `electron/preload.js` — unchanged (thin bridge remains valid).

---

## Recommended First Implementation Task

**Create the platform Firebase project and rewrite `firestore.rules` for tenant isolation, then enforce `schoolId` in one service as a proving ground — before any multi-tenant data exists.**

Concretely:

1. Provision the single platform Firebase project (separate from any per-school dev project).
2. Add `schoolId` to a copy of one collection's documents in a **development-only** Firestore database (no production data touched).
3. Rewrite `firestore.rules` so every academic match requires `resource.data.schoolId == request.auth.token.schoolId` (with role checks preserved and default deny), and deploy to the dev database only.
4. Update `src/db/studentService.js` writes to include `schoolId` and reads to filter `where('schoolId', '==', activeSchoolId)`, wired to a temporary active-school value.
5. Write Firebase Emulator rules-unit tests covering the cross-tenant matrix in §8.5; require all to pass before extending `schoolId` to other collections.

**Why first:** rules are the enforcement boundary. Until rules reject cross-tenant reads/writes, adding `schoolId` to documents provides zero security (Finding 4.3, 4.5). Proving the rule pattern on one collection in an emulator/dev database de-risks the entire migration. All source changes are confined to new/modified files; no existing school's production data is touched.

Stop here — awaiting approval before any implementation begins.