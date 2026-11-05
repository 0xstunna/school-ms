# 🏫 School Management System

A desktop application for secondary schools (S1–S6) supporting dual grading —
Legacy UCE and UNEB competence-based (NLSC) — with SchoolPay-driven student
import. Built with Electron, React, Vite, TailwindCSS, and Firebase/Firestore.

> ⚠️ **PowerShell note:** `npm install`, `npm run dev`, `npm test`, and other
> npm scripts are blocked by the PowerShell execution policy on this machine.
> Install dependencies elsewhere, then run tests with
> `node src/services/__tests__/<file>.test.js` and build with
> `node node_modules/vite/bin/vite.js build`.

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18
- A Firebase project (web app config) — copy `.env.example` to `.env` and fill in
  your values from Firebase Console → Project Settings → Your Apps → Web App.

### Install & Run

```bash
# 1. Install dependencies (run outside PowerShell if execution policy blocks it)
npm install

# 2. Start in development mode
npm run dev

# 3. Build for production
npm run electron:build
```

### Running tests & build on PowerShell (execution policy blocks npm scripts)

```bash
# Run individual test files
node src/services/__tests__/grading.test.js
node src/services/__tests__/ranking.test.js
node src/services/__tests__/marksEntry.test.js
node src/services/__tests__/studentImport.test.js

# Build for production
node node_modules/vite/bin/vite.js build
```

On **first launch**, you'll see the **Setup Wizard** where you:
1. Enter your school profile (name, motto, address, academic year, current term)
2. Create the first Admin account (email + password)

After setup, only Admins can create new users. The SetupWizard is idempotent — it
skips setup if `isSetupComplete()` already returns true.

---

## 🗂️ Project Structure

```
school-ms/
├── electron/
│   ├── main.js          # Electron main process
│   └── preload.js       # Secure context bridge (minimal)
├── src/
│   ├── db/
│   │   ├── firebase.js                # Conditional Firebase init (null when no VITE_FIREBASE_* env)
│   │   ├── configService.js           # School config, setup state
│   │   ├── userService.js             # Firebase Auth, user CRUD (createFirstAdmin recovers existing accounts)
│   │   ├── studentService.js          # Student CRUD (schoolpayCode, source fields, search)
│   │   ├── studentImportService.js    # SchoolPay-driven import (parse, validate, match, classify, commit ≤500/batch)
│   │   ├── staffService.js            # Staff CRUD
│   │   ├── subjectService.js          # Subject CRUD
│   │   ├── feeService.js              # Fee structures + payments
│   │   ├── attendanceService.js       # Daily attendance
│   │   ├── examService.js             # Exams + results (marks entry)
│   │   ├── classService.js            # Classes collection — assessmentMode (LEGACY/NLSC)
│   │   ├── gradingSettingsService.js  # NLSC grade bands, weights, certificate rule
│   │   ├── projectWorkService.js      # New curriculum project work records (ACHIEVEMENT_LEVELS = A–E)
│   │   ├── payrollService.js          # Payroll + expenses
│   │   └── reportCardService.js       # Report card data (delegates to grading system)
│   ├── gradingSystems/
│   │   ├── gradingSystemInterface.js  # GradingSystem interface contract
│   │   ├── legacyGrading.js           # UCE model (untouched legacy logic)
│   │   └── nlscGrading.js             # UNEB competence-based model (S1–S4)
│   ├── lib/
│   │   └── xlsx.mjs                   # Vendored SheetJS parser (dynamic import, out of bundle)
│   ├── scripts/
│   │   └── migrateAssessmentMode.js   # Dry-run migration: sets assessmentMode per class
│   ├── services/
│   │   ├── resultsService.js          # Centralized results + dual ranking
│   │   └── __tests__/                 # grading, ranking, marksEntry, studentImport unit tests
│   ├── contexts/
│   │   └── AuthContext.jsx            # Session management (Firebase Auth + localStorage)
│   ├── guards/
│   │   └── RoleGuard.jsx              # Route-level role enforcement
│   ├── utils/
│   │   ├── constants.js               # Classes, streams, roles, nav config (feature keys on NAV_ITEMS)
│   │   ├── featureFlags.js            # Central feature flags (FEATURES, isEnabled, financeEnabled, getVisibleNavItems)
│   │   └── grading.js                 # Legacy grade scale + generateAcademicYears (single years 2026 onward)
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.jsx          # Main shell
│   │   │   ├── Sidebar.jsx            # Flag-aware nav rendering (getVisibleNavItems)
│   │   │   └── Topbar.jsx             # Header bar
│   │   └── common/
│   │       ├── Button.jsx             # Reusable button (variants + sizes)
│   │       ├── Input.jsx              # Input, Select, Textarea, FormRow
│   │       ├── Modal.jsx              # Animated modal + ConfirmModal
│   │       └── Badge.jsx              # Badge, StatCard, Card, EmptyState, etc.
│   ├── pages/
│   │   ├── setup/SetupWizard.jsx
│   │   ├── auth/Login.jsx
│   │   ├── dashboard/Dashboard.jsx    # Gated hidden-module reads/widgets
│   │   ├── students/Students.jsx      # Student register + add/edit modal (schoolpayCode column, read-only SchoolPay fields)
│   │   ├── students/ImportStudents.jsx # SchoolPay import: /students/import (admin-only), upload, map, preview, commit
│   │   ├── attendance/Attendance.jsx
│   │   ├── exams/Exams.jsx
│   │   ├── fees/Fees.jsx
│   │   ├── staff/Staff.jsx            # Also exports Payroll, Expenses, Settings
│   │   ├── settings/Subjects.jsx
│   │   ├── projectWork/ProjectWork.jsx # New curriculum project work (NLSC) — 3-section Add/Edit form
│   │   └── users/UserManagement.jsx   # Role picker filters bursar when finance disabled
│   ├── App.jsx            # Root router + setup/auth gate, FeatureRoute on every route
│   ├── main.jsx           # React entry
│   └── index.css          # Tailwind + global styles
├── public/
├── index.html
├── vite.config.js
├── tailwind.config.js
└── package.json
```

---

## 🔐 Roles & Access

| Feature            | Admin | Teacher | Bursar |
|--------------------|:-----:|:-------:|:------:|
| Dashboard          | ✅    | ✅      | ✅     |
| Students           | ✅    | ✅      | ❌     |
| Import Students    | ✅    | ❌      | ❌     |
| Attendance         | ✅    | ✅      | ❌     |
| Exams & Results    | ✅    | ✅      | ❌     |
| Fees               | ✅    | ❌      | ✅     |
| Payroll            | ✅    | ❌      | ✅     |
| Expenses           | ✅    | ❌      | ✅     |
| Staff              | ✅    | ❌      | ❌     |
| Subjects           | ✅    | ❌      | ❌     |
| User Accounts      | ✅    | ❌      | ❌     |
| Settings           | ✅    | ❌      | ❌     |

Staff module is hidden by feature flag (`staff: false`). Bursar sees "No modules enabled
for your role yet" when `financeEnabled` is false.

---

## 🏫 Academic Structure

- Classes: **S1 – S6**
- Streams: **A, B, C, D, E** (per class)
- Combined: `S1A`, `S1B` ... `S6E` (30 class-streams total)

---

## 🗄️ Firestore Schema

All documents stored in **Firebase Firestore** (with persistent offline cache).

| Collection | Document ID pattern | Description |
|------------|---------------------|-------------|
| `config` | `app_config`, `grading_settings` | School profile; NLSC grade bands / weights / certificate rule |
| `classes` | `class_<level>_<year>` | Per-class `assessmentMode` (`LEGACY`\|`NLSC`) — set by migration/admin |
| `users` | `user_<id>` | Staff login accounts (Firebase Auth) |
| `students` | `student_<id>` (manual) or `schoolpayCode` (imported) | Student records — `schoolpayCode` + `source` ('manual'\|'schoolpay') fields |
| `staff` | `staff_<id>` | Staff records |
| `subjects` | `subject_<id>` | Subjects per class level |
| `exams` | `exam_<id>` | Exam definitions |
| `exam_results` | `result_<examId>_<studentId>` | Per-student exam marks (legacy grade/points preserved) |
| `projectWork` | `pw_<studentId>_<year>_<rand>` | New curriculum project work records (S1–S4) |
| `fee_structures` | `feestructure_<id>` | Fee amounts per class/term/year |
| `fee_payments` | `feepayment_<id>` | Individual fee payments |
| `attendance_sessions` | `attendance_<id>` | Daily attendance per class/date |
| `payroll_entries` | `payroll_<id>` | Salary payment records |
| `expenses` | `expense_<id>` | School expense records |

**Data safety:** existing `exam_results` marks/grades are never rewritten. The migration
only sets `assessmentMode` on `classes` docs.

**Firestore security rules:** version 2, dedicated `students` match block (admin-only
write, client-chosen IDs, no delete), catch-all for other docs. Rules live in Firebase
Console only — not applied from the repo.

---

## 🎓 Grading — Dual Model (Legacy UCE + UNEB NLSC)

The app supports two grading models side by side. Report cards, broadsheets and
printing all route through a single `GradingSystem` interface; the active model
is chosen per class.

### Model selection

A class's `assessmentMode` (`LEGACY` or `NLSC`) lives on its `classes` document
and is set by the migration script or an admin. If no mode is stored, a
year-based rule applies: **current-year S1–S4 → NLSC**, everything else →
`LEGACY`. Existing classes keep `LEGACY` unless explicitly migrated.

### LEGACY (UCE — D1/F9, aggregates, divisions)

Unchanged. Scale: A 80–100, B 70–79, C 60–69, D 50–59, F 0–49. Computes
aggregate marks/average percentage, overall grade, Division I–IV/Fail, and
stream + overall class position. Historical `exam_results` marks and grades are
never rewritten.

### NLSC (UNEB competence-based, lower secondary S1–S4)

Source of truth: Parliament statement of 20 Feb 2025 (Minister Peter Ogwang)
on UNEB grading under the new curriculum.

- Subject final score = **CA × caWeight% + exam × examWeight%** (defaults CA 20 /
  exam 80; admin-editable in Settings → Grading)
- Letter grades with descriptors: **A exceptional**, **B outstanding**, **C
  satisfactory**, **D basic**, **E elementary**
- Grade-band cut-offs live in `config/grading_settings`, seeded as placeholders
  flagged **"VERIFY WITH UNEB"** and editable by admin only
- **No aggregate, no division.** Overall result lists subject letters and the
  count of subjects at D or above
- Certificate: qualifies when ≥1 subject is at D or above (configurable rule)
- Missing CA → **"Not graded"** with a visible warning
- Project work is shown as a stand-alone line on the NLSC report card and
  transcript view, separate from subject grades
- Ranking uses mean final score per learner (stream + overall class position)

### Collections added

| Collection | Purpose |
|------------|---------|
| `classes` | Stores `assessmentMode` per class/year |
| `config/grading_settings` | NLSC bands, weights, certificate rule (admin-only write) |
| `projectWork` | Project work records for NLSC report cards |

### Migration

Run `node src/scripts/migrateAssessmentMode.js` (dry-run by default — no writes).
Pass `--write` to apply. Before writing, it backs up all affected collections to
`backups/migrate-<timestamp>/`. It sets `assessmentMode` on classes only and
never touches marks or grades.

```bash
# Dry run (safe, shows what would change)
node src/scripts/migrateAssessmentMode.js

# Apply (requires Firebase config + network)
node src/scripts/migrateAssessmentMode.js --write
```

---

## 📥 SchoolPay Student Import

The app supports bulk-importing students from a SchoolPay export file (CSV or Excel).
There is **no SchoolPay API integration** — the admin uploads a SchoolPay export
and the app parses it in the browser.

Route: **/students/import** (admin-only, `Import Students` nav item in Admin section).

### How it works

1. **Upload** — Admin uploads a `.csv`, `.xlsx`, or `.xls` file exported from SchoolPay.
2. **Column mapping** — The admin maps each file column to a student field
   (SchoolPay Code, Full Name, Class Level, Admission Number). Mappings are saved
   to `localStorage` for reuse.
3. **Validation** — Rows are validated: missing SchoolPay code, duplicate code within
   the file, and unknown class are flagged. The admin can fix or skip problem rows.
4. **Reconciliation** — Rows are matched against existing students:
   - **New** → created with doc ID = `schoolpayCode`, `source: 'schoolpay'`
   - **Link** → existing code-less student matched by admission number, linked via `schoolpayCode`
   - **Update** → SchoolPay-owned fields (name, class) overwritten; school-owned fields
     (stream, guardian, notes, marks) preserved
   - **Class changed** → class history appended, stream cleared, flagged as needing a stream
   - **Unchanged** → no write
5. **Commit** — Changes are written via Firestore batched writes (max 500 per batch),
   `merge: true`. Optionally, with the "full list" safeguard checked, SchoolPay
   students absent from the import are marked `inactive` (never deleted). Manual
   students are never inactivated.

### Field ownership

| Field | Owner | On import |
|-------|-------|-----------|
| `schoolpayCode` | SchoolPay | Written (doc ID for new students) |
| `fullName` | SchoolPay | Overwritten |
| `classLevel` | SchoolPay | Overwritten |
| `stream` | School | Never touched |
| `guardian` fields | School | Never touched |
| `notes`, `photo`, `curriculum`, `marks` | School | Never touched |

### Manual vs imported students

- **Manual** ("Add Student" form): `source: 'manual'`, random doc ID, editable fields,
  never inactivated.
- **Imported**: `source: 'schoolpay'`, doc ID = `schoolpayCode`, SchoolPay-owned fields
  read-only in the edit modal.

### Testing

`node src/services/__tests__/studentImport.test.js` — 13 scenarios covering code
normalization, validation, matching, classification, inactivation safeguard, batched
writes (≤500), merge preservation of school-owned fields, and class-change history.

---

## 🏗️ Feature Flags

Central flags live in `src/utils/featureFlags.js`:

- `FEATURES` — object of feature → enabled state
- `isEnabled(feature)` — check if a feature is on
- `financeEnabled` — convenience for the finance feature
- `getVisibleNavItems(role)` — nav items filtered by role + feature flags

`Sidebar.jsx` renders only flag-visible nav items. `App.jsx` wraps every route in
`<FeatureRoute>` (disabled → dashboard redirect). `Dashboard.jsx` gates hidden-module
Firestore reads (staff, fees, attendance) and stat cards/quick links. `UserManagement.jsx`
filters `bursar` out of the role picker when `!financeEnabled`.

---

## 🔧 Building for Production

```bash
# Build Vite app
node node_modules/vite/bin/vite.js build

# Build Electron installer
npm run electron:build   # (blocked on PowerShell; run outside PowerShell)

# Output: ./release/
#   - Windows: .exe (NSIS installer)
#   - macOS:   .dmg
#   - Linux:   .AppImage
```

---

## 🔒 Security Notes

- Authentication via **Firebase Auth** (email/password) — no bcryptjs, no plain-text passwords
- `createFirstAdmin` catches `auth/email-already-in-use`, signs in to the existing
  account, and overwrites the Firestore profile via `setDocument`
- `firebase.js` is conditionally initialized (null when no `VITE_FIREBASE_*` env) so
  modules import safely in plain Node tests
- Role checks enforced at UI render level (`RoleGuard`) and via feature flags
- Session stored via Firebase Auth + localStorage; cleared on logout
- `.env` contains real Firebase config — **do not modify or commit**
- Firestore rules live in Firebase Console only (version 2), not yet published

---

## 📋 First Steps After Setup

1. **Settings** → Verify school name, academic year, and current term
2. **Subjects** → Add all subjects and assign them to class levels
3. **Staff** → Register all teaching and non-teaching staff
4. **User Accounts** → Create Teacher and Bursar login accounts
5. **Students** → Import (SchoolPay export) or add students to their respective class/stream
6. **Fees** → Configure fee structures per class level and term
7. **Attendance & Exams** → Teachers can now mark attendance and enter marks
8. **Settings → Grading** → (NLSC schools) Verify CA/exam weights and grade bands
   (bands are placeholders flagged "VERIFY WITH UNEB" — confirm against the
   official UNEB cut-offs before publishing report cards)
9. **Migration** → Run `node src/scripts/migrateAssessmentMode.js` (dry-run, then
   `--write`) to set `assessmentMode` on current-year S1–S4 classes to NLSC

---

## 🛠️ Tech Stack

| Tool            | Version  | Purpose                     |
|-----------------|----------|-----------------------------|
| Electron        | ^28      | Desktop wrapper             |
| React           | ^18      | UI framework                |
| Vite            | ^5       | Build tool + dev server     |
| TailwindCSS     | ^3.4     | Utility-first styling       |
| Firebase        | ^10.12   | Auth + Firestore database   |
| React Router    | ^6.22    | Client-side routing         |
| Lucide React    | ^0.358   | Icon library                |
| electron-builder| ^24      | Cross-platform builds       |

Not used: PouchDB, bcryptjs.
