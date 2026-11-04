# 🏫 School Management System

A fully offline-first desktop application for secondary schools (S1–S6). Built with Electron, React, Vite, TailwindCSS, and PouchDB.

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18
- npm >= 9

### Install & Run

```bash
# 1. Install dependencies
npm install

# 2. Start in development mode (opens Electron + Vite dev server)
npm run dev

# 3. Build for production
npm run electron:build
```

On **first launch**, you'll see the **Setup Wizard** where you:
1. Enter your school profile (name, motto, address, academic year, current term)
2. Create the first Admin account (email + password)

After setup, public signup is permanently disabled. Only Admins can create new users.

---

## 🗂️ Project Structure

```
school-ms/
├── electron/
│   ├── main.js          # Electron main process
│   └── preload.js       # Secure context bridge (minimal)
├── src/
│   ├── db/
│   │   ├── index.js           # Firebase helper re-exports
│   │   ├── configService.js   # School config, setup state
│   │   ├── userService.js     # Auth, user CRUD
│   │   ├── studentService.js  # Student CRUD (schoolpayCode, source fields)
│   │   ├── studentImportService.js  # SchoolPay-driven import (parse, validate, commit)
│   │   ├── staffService.js    # Staff CRUD
│   │   ├── subjectService.js  # Subject CRUD
│   │   ├── feeService.js      # Fee structures + payments
│   │   ├── attendanceService.js  # Daily attendance
│   │   ├── examService.js     # Exams + results (marks entry)
│   │   ├── classService.js    # Classes collection — assessmentMode (LEGACY/NLSC)
│   │   ├── gradingSettingsService.js  # NLSC grade bands, weights, certificate rule
│   │   ├── projectWorkService.js  # New curriculum project work records
│   │   ├── payrollService.js  # Payroll + expenses
│   │   └── reportCardService.js # Report card data (delegates to grading system)
│   ├── gradingSystems/
│   │   ├── gradingSystemInterface.js  # GradingSystem interface contract
│   │   ├── legacyGrading.js           # UCE model (untouched legacy logic)
│   │   └── nlscGrading.js             # UNEB competence-based model (S1–S4)
│   ├── lib/
│   │   └── xlsx.mjs           # Vendored SheetJS parser (dynamic import, out of bundle)
│   ├── scripts/
│   │   └── migrateAssessmentMode.js   # Dry-run migration: sets assessmentMode per class
│   ├── services/
│   │   ├── resultsService.js          # Centralized results + dual ranking
│   │   └── __tests__/                 # grading, ranking, marksEntry, studentImport unit tests
│   ├── contexts/
│   │   └── AuthContext.jsx    # Session management (localStorage)
│   ├── guards/
│   │   └── RoleGuard.jsx      # Route-level role enforcement
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.jsx  # Main shell
│   │   │   ├── Sidebar.jsx    # Role-based nav
│   │   │   └── Topbar.jsx     # Header bar
│   │   └── common/
│   │       ├── Button.jsx     # Reusable button (variants + sizes)
│   │       ├── Input.jsx      # Input, Select, Textarea, FormRow
│   │       ├── Modal.jsx      # Animated modal + ConfirmModal
│   │       └── Badge.jsx      # Badge, StatCard, Card, EmptyState, etc.
│   ├── pages/
│   │   ├── setup/SetupWizard.jsx
│   │   ├── auth/Login.jsx
│   │   ├── dashboard/Dashboard.jsx
│   │   ├── students/Students.jsx       # Student register + add/edit modal
│   ├── students/ImportStudents.jsx # SchoolPay import: upload, map, preview, commit
│   │   ├── attendance/Attendance.jsx
│   │   ├── exams/Exams.jsx
│   │   ├── fees/Fees.jsx
│   │   ├── staff/Staff.jsx       # Also exports Payroll, Expenses, Settings
│   │   ├── settings/Subjects.jsx
│   │   ├── projectWork/ProjectWork.jsx   # New curriculum project work (NLSC)
│   │   └── users/UserManagement.jsx
│   ├── utils/
│   │   ├── constants.js   # Classes, streams, roles, nav config
│   │   └── grading.js     # Legacy grade scale (kept untouched)
│   ├── App.jsx            # Root router + setup/auth gate
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

---

## 🏫 Academic Structure

- Classes: **S1 – S6**
- Streams: **A, B, C, D, E** (per class)
- Combined: `S1A`, `S1B` ... `S6E` (30 class-streams total)

---

## 🗄️ Firestore Schema

All documents stored in Firestore (with persistent offline cache via IndexedDB).

| Collection | Document ID pattern | Description |
|------------|---------------------|-------------|
| `config` | `app_config`, `grading_settings` | School profile; NLSC grade bands / weights / certificate rule |
| `classes` | `class_<level>_<year>` | Per-class `assessmentMode` (`LEGACY`\|`NLSC`) — set by migration/admin |
| `users` | `user_<id>` | Staff login accounts (hashed pw) |
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

**Data safety:** existing `exam_results` marks/grades are never rewritten. The migration only sets `assessmentMode` on `classes` docs.

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

The app supports bulk-importing students from a SchoolPay export file (CSV or Excel). There is **no SchoolPay API integration** — the admin uploads a SchoolPay export and the app parses it in the browser.

### How it works

1. **Upload** — Admin goes to **Students → Import Students** (admin-only route) and uploads a `.csv`, `.xlsx`, or `.xls` file exported from SchoolPay.
2. **Column mapping** — The admin maps each file column to a student field (SchoolPay Code, Full Name, Class Level, Admission Number). Mappings are saved to `localStorage` for reuse.
3. **Validation** — Rows are validated: missing SchoolPay code, duplicate code within the file, and unknown class are flagged. The admin can fix or skip problem rows.
4. **Reconciliation** — Rows are matched against existing students:
   - **New** → created with doc ID = `schoolpayCode`, `source: 'schoolpay'`
   - **Link** → existing code-less student matched by admission number, linked via `schoolpayCode`
   - **Update** → SchoolPay-owned fields (name, class) overwritten; school-owned fields (stream, guardian, notes, marks) preserved
   - **Class changed** → class history appended, stream cleared, flagged as needing a stream
   - **Unchanged** → no write
5. **Commit** — Changes are written via Firestore batched writes (max 500 per batch), `merge: true`. Optionally, with the "full list" safeguard checked, SchoolPay students absent from the import are marked `inactive` (never deleted). Manual students are never inactivated.

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

- **Manual** ("Add Student" form): `source: 'manual'`, random doc ID, editable fields, never inactivated.
- **Imported**: `source: 'schoolpay'`, doc ID = `schoolpayCode`, SchoolPay-owned fields read-only in the edit modal.

### Testing

`node src/services/__tests__/studentImport.test.js` — 13 scenarios covering code normalization, validation, matching, classification, inactivation safeguard, batched writes (≤500), merge preservation of school-owned fields, and class-change history.


---

## 🔧 Building for Production

```bash
# Build Electron installer
npm run electron:build

# Output: ./release/
#   - Windows: .exe (NSIS installer)
#   - macOS:   .dmg
#   - Linux:   .AppImage
```

### Testing

```bash
# Run all unit tests (grading, ranking, marks entry)
npm test
```

Tests are plain Node scripts under `src/services/__tests__/`:
- `grading.test.js` — both grading systems, band edge cases, missing CA, certificate rule
- `ranking.test.js` — legacy dual ranking
- `marksEntry.test.js` — marks validation
- `studentImport.test.js` — import: normalization, validation, matching, classification, inactivation safeguard, batched writes (≤500)


---

## 🔒 Security Notes

- Passwords are hashed with **bcryptjs** (10 salt rounds) — never stored in plain text
- No public signup endpoint — user creation is Admin-only
- Role checks enforced at **both** UI render level (RoleGuard) and service level
- Session stored in localStorage; cleared on logout
- All data stays on the local device — no network sync

---

## 📋 First Steps After Setup

1. **Settings** → Verify school name, academic year, and current term
2. **Subjects** → Add all subjects and assign them to class levels (e.g. Mathematics → S1, S2, S3, S4)
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
| PouchDB         | ^8       | Offline-first local DB      |
| bcryptjs        | ^2.4     | Password hashing            |
| React Router    | ^6.22    | Client-side routing         |
| Lucide React    | ^0.358   | Icon library                |
| electron-builder| ^24      | Cross-platform builds       |
