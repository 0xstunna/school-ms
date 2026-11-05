# 🏫 School Management System

A desktop app that helps Ugandan secondary schools (S1–S6) run their academics —
students, attendance, exams, grading, fees, payroll, expenses, and report cards
— all in one place, on the school's own computer.

## Why schools need this

**The curriculum is changing, but your records shouldn't break.**
Uganda's New Lower Secondary Curriculum (NLSC) replaces the old UCE aggregate/division
model with competence-based grading (CA + exam, letter bands A–E, no division).
But S5–S6 and older classes still run on legacy UCE. Most school software forces
you to pick one. This app runs both side by side, class by class — legacy classes
keep working exactly as before, while current-year S1–S4 move to NLSC.

**Student enrolment is stuck in SchoolPay.**
Schools admit students through SchoolPay, but re-typing every name, class, and
code by hand is slow and error-prone. Upload a SchoolPay export (CSV or Excel),
map the columns once, preview exactly what will change — new students, updates,
links to existing records, class changes — and commit in one batch. SchoolPay
fields come from the file; school-owned fields (stream, guardian, notes, marks)
are never overwritten.

**Everything lives in spreadsheets and paper.**
One app for student registers, daily attendance, exam marks, fee structures and
payments, staff payroll, expenses, and printable report cards/broadsheets.
No more reconciling five different Excel files at end of term.

**Staff need different levels of access.**
Admins see everything. Teachers see students, attendance, and exams. Bursars see
fees, payroll, and expenses — nothing more. Role-based sidebar keeps each person
in their lane.

## What it does

### Two grading models, one app
- **LEGACY (UCE)** — aggregate/division model for older classes. Historical marks
  and grades are never touched.
- **NLSC (UNEB competence-based)** — CA × weight + exam × weight, letter grades
  A–E with descriptors, no aggregate/division, project work as a standalone line
  on report cards, certificate eligibility (subjects at D or above).
- Choose per class. Migrate when you're ready; keep legacy running until then.

### SchoolPay-driven student import
Upload a SchoolPay export, map columns (saved for reuse), preview new/updated/
linked/class-changed rows with counts, fix or skip problem rows, commit via
batched Firestore writes (max 500 per batch). Students absent from an import can
be marked inactive — nothing is ever deleted.

### Reporting
Print report cards and class broadsheets for both grading models. SchoolPay codes
appear on report cards and student lists so payments and records stay aligned.

### Roles
- **Admin** — everything: students, staff, users, settings, imports, fees, payroll
- **Teacher** — dashboard, students, attendance, exams & results
- **Bursar** — dashboard, fees, payroll, expenses

## Getting started

1. **Set up the school** — First launch opens the Setup Wizard: school profile
   (name, motto, address, academic year, term) + first Admin account.
2. **Configure subjects & staff** — Add subjects per class level, register staff.
3. **Create user accounts** — Teacher and Bursar logins (Admin-only).
4. **Bring in students** — Import from a SchoolPay export file or add manually.
5. **Set up fees & assessments** — Fee structures per class/term; record
   attendance and enter marks.
6. **Choose your grading model** — Migration script sets current-year S1–S4 to
   NLSC (dry-run first, backs up before writing). Legacy classes stay as-is.
7. **Verify NLSC settings** — Before publishing NLSC report cards, check CA/exam
   weights and grade bands in Settings → Grading (seeded as placeholders flagged
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
