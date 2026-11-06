# Alama — School Management System

Enter marks, get reports.

A desktop app for Ugandan secondary schools (S1–S6) that turns exam and CA marks
into report cards, broadsheets, and fee statements — supporting both the legacy
UCE grading and the new UNEB competence-based (NLSC) model at the same time.

## The core loop

1. **Enter marks** — Teachers record CATs, midterms, and finals per subject.
2. **Generate reports** — One click produces report cards and class broadsheets,
   computed under the right grading model for each class.
3. **Get paid** — Bursar records fee payments and prints receipts.

Everything else (students, attendance, staff, payroll, expenses) exists to
support that loop.

## Two grading models, side by side

Uganda's New Lower Secondary Curriculum (NLSC) replaces the old UCE
aggregate/division model for current-year S1–S4 — but S5–S6 and older classes
still run on legacy UCE. Most school software makes you choose. This app runs
both:

- **LEGACY (UCE)** — aggregate/division model for older classes. Historical marks
  and grades are never touched.
- **NLSC (competence-based)** — CA × weight + exam × weight, letter grades A–E
  with descriptors, no aggregate/division, project work as a standalone line on
  report cards, certificate eligibility (subjects at D or above).

Pick per class. Migrate when ready; legacy keeps working until then.

## SchoolPay-driven student import

Admission runs through SchoolPay. Instead of re-typing students, upload a
SchoolPay export (CSV or Excel), map the columns (saved for reuse), preview exactly
what will change — new students, updates, links to existing records, class
changes — and commit in one batch. SchoolPay fields (code, name, class) come
from the file; school-owned fields (stream, guardian, notes, marks) are never
overwritten. Students absent from an import can be marked inactive — nothing is
ever deleted.

## Reports that matter

- **Report cards** — per student, per term, with grades, positions, and remarks
  (legacy) or letters + subjects at D or above + certificate status (NLSC).
- **Class broadsheets** — the whole class on one page, with SchoolPay codes so
  finance and records stay aligned.
- **NLSC report cards** include project work as a separate line.

## Who sees what

| Role | Access |
|------|--------|
| **Admin** | Everything — students, staff, users, settings, imports, fees, payroll |
| **Teacher** | Dashboard, students, attendance, exams & results |
| **Bursar** | Dashboard, fees, payroll, expenses |

## Getting started

1. **Set up the school** — First launch: school profile (name, motto, address,
   academic year, term) + first Admin account.
2. **Subjects & staff** — Add subjects per class level; register staff.
3. **User accounts** — Teacher and Bursar logins (Admin-only).
4. **Students** — Import from a SchoolPay export or add manually.
5. **Fees & assessments** — Fee structures per class/term; record attendance and
   enter marks.
6. **Grading model** — Migration script sets current-year S1–S4 to NLSC
   (dry-run first, backs up before writing). Legacy classes stay as-is.
7. **Verify NLSC settings** — Check CA/exam weights and grade bands in Settings
   → Grading before publishing NLSC report cards (seeded as placeholders flagged
   "VERIFY WITH UNEB").

## How to run

```bash
# Install dependencies (outside PowerShell if execution policy blocks npm scripts)
npm install

# Start in development mode
npm run dev

# Build Electron installer (Windows .exe, macOS .dmg, Linux .AppImage)
npm run electron:build
```

On PowerShell (npm scripts blocked by execution policy):

```bash
# Unit tests
node src/services/__tests__/grading.test.js
node src/services/__tests__/ranking.test.js
node src/services/__tests__/marksEntry.test.js
node src/services/__tests__/studentImport.test.js

# Build the Vite app
node node_modules/vite/bin/vite.js build
```

You'll need a Firebase project — copy `.env.example` to `.env` and add your web
app config from the Firebase Console.

## Data safety

- Historical exam marks and grades are never rewritten.
- Migration runs dry-run by default, backs up before writing, and only sets a
  grading mode on classes — never touches marks.
- Firestore rules are version 2 (admin-only student writes, client-chosen IDs for
  imports); they live in Firebase Console, not in the repo.

## Built with

Electron, React, Vite, TailwindCSS, Firebase (Auth + Firestore), Lucide React,
electron-builder.
