# 📘 Admin Guide — Alama

Plain-language guide for school staff. No technical background assumed.

Roles in this system:

| Role | What they can do |
|------|------------------|
| **Admin** | Everything — school settings, users, subjects, imports, fees, payroll, exports |
| **Teacher** | Students, attendance, exams & marks, project work (own classes) |
| **Bursar** | Fees, payroll, expenses |

---

## 1. First-time setup

The very first person to open the app walks through the **Setup Wizard**. This happens only once.

1. Launch the app. The **Setup Wizard** opens automatically.
2. **Step 1 — School profile:** enter the school name, motto, address, phone, email, academic year, and current term. You can edit these later in Settings.
3. **Step 2 — Admin account:** create the first administrator account (full name, email, password, min. 8 characters). Keep these credentials safe — this is the account that can create other staff accounts.
4. Click **Complete Setup**, then **Open Dashboard →**.

**After setup, the wizard never runs again.** A flag is written to the database so the app knows setup is complete. If you need to change school details later, go to **Settings** (admin only).

> If an earlier setup attempt created the account but failed before finishing, re-running setup reuses the existing account instead of duplicating it.

---

## 2. Uploading the school logo

1. Sign in as **Admin**.
2. Go to **Settings → School Profile**.
3. Under **School Logo**, click the preview box and choose a PNG / JPG / WebP image (max ~500 KB).
4. The logo is compressed and shown in the preview box. Click **Replace** to change it, or the trash icon to remove it.
5. Click **Save Settings**.

The logo appears on report cards and broadsheets. Leave it unset if you prefer the school name only.

---

## 3. Importing students from SchoolPay

Instead of typing students one by one, import them from a SchoolPay export (CSV or Excel).

1. Sign in as **Admin**.
2. Go to **Students → Import Students**.
3. Upload your SchoolPay export file.
4. **Map the columns:** match each SchoolPay column (student code, name, class) to the corresponding field. The app remembers your mapping so you don't have to redo it next time.
5. **Preview** exactly what will change: new students to add, existing students to update, and class changes. SchoolPay-owned fields (code, name, class) come from the file; school-owned fields (stream, guardian, notes, marks) are never overwritten.
6. When you're happy, click **Commit** to apply everything in one batch.

- Students absent from the import are marked **inactive** — nothing is ever deleted.
- Re-importing the same file is safe (idempotent): it updates matching students rather than duplicating them.

---

## 4. Creating teacher accounts

Only **Admin** can create accounts.

1. Sign in as **Admin**.
2. Go to **Users → User Accounts → New User**.
3. Fill in:
   - Full name
   - Email address
   - Role: **Teacher** (or Bursar)
   - Assigned classes (optional — leave blank for all classes)
   - Temporary password (min. 8 characters). Tell the user to change it after first login.
4. Click **Create User**.

The new user can sign in immediately with their email and temporary password. The admin is **not** signed out while creating accounts.

To edit an existing user (name, role, classes), open **User Accounts**, click the edit (pencil) icon, make changes, and save. Passwords cannot be changed here — the user changes their own password, or an admin resets it (see §8).

---

## 5. Entering marks and CA/project work

### 5.1 Create an exam

1. Sign in as **Admin** or **Teacher**.
2. Go to **Exams & Results**.
3. Click **Create Exam**.
4. Choose: exam name, type (CAT / Midterm / Final), date, class, stream, subject, and "out of" (max marks).
5. Click **Create Exam**.

> Subjects must exist first. If you see "No subjects configured," go to **Settings → Subjects** and add them.

### 5.2 Enter marks

1. In **Exams & Results**, open the exam you created.
2. The student list for that class/stream appears with an empty mark box per student.
3. Type each student's mark. Leave blank if a student was absent — blank is **not** treated as zero.
4. Click **Save**. Marks are validated (must be between 0 and "out of").
5. Saving twice for the same student + exam overwrites the earlier entry (no duplicates).

### 5.3 CA and project work (NLSC / new curriculum)

For classes on the new curriculum (S1–S4 current year), each subject's final score is:

**Final = CA × 20% + Exam × 80%**

These percentages are admin-editable in **Settings → NLSC Grading Settings**.

**Project work** is recorded separately and shows as a stand-alone line on NLSC report cards:

1. Go to **Project Work**.
2. Choose the academic year, select a student, and enter:
   - Project title
   - Subject / learning area
   - Achievement level (A–E)
   - Assessor and notes (optional)
3. Click **Save**.

A student can have multiple project-work records across different years.

---

## 6. Printing report cards and broadsheets

### 6.1 Report cards (one student)

1. Go to **Exams & Results**, generate report cards for a class/stream (**Generate**).
2. In the results table, click **Print** next to a student.
3. A print dialog opens for that student's card. Choose your printer or **Save as PDF**.

### 6.2 Report cards (whole class — combined document)

1. Generate report cards for the class/stream.
2. Click **Print All (N)** at the top of the table.
3. The app builds **one combined document** (one card per page) and opens a single print dialog.
4. Choose **Save as PDF** to save all cards in one file. This works for 60+ students without freezing.

Each card is on its own page, so pages never split a student's card across two sheets.

### 6.3 Class broadsheet

1. Go to **Exams & Results → Class Broadsheet**.
2. Choose class, stream, and term, then **Generate**.
3. Click **Print Broadsheet**. The whole class fits on one landscape page.
4. If the class is large and the broadsheet spans multiple pages, each row stays intact (no row split across pages) and the column header repeats on every page.

> Broadsheets include SchoolPay codes so finance and records stay aligned.

---

## 7. Exporting a backup (admin only)

1. Sign in as **Admin**.
2. Go to **Settings → Data backup / export**.
3. Click **Export data (JSON)**.
4. The browser downloads a file like `alama-backup_S1_Term 1_2026-11-07.json`.

**What's included:** students, exams, results/marks, project work, classes, school settings, grading settings (bands, weights).

**What's NOT included:** user accounts / auth data (passwords are never exported).

Keep the backup somewhere safe. To restore, you'd need a separate import step (contact your administrator/support). The logo (base64) **is** included, so the backup is fully restorable including school branding.

---

## 8. When a teacher forgets their password

There are two scenarios:

### The teacher remembers their current password and wants to change it

1. The teacher signs in.
2. They change their password from their profile/account settings (they must supply their current password to confirm the change).

### The teacher is locked out / forgot their password (admin resets it)

**Option A — Firebase "Forgot password" (if enabled):** the teacher uses the password-reset link sent to their email.

**Option B — Admin creates a temporary password:** there is no "reset password" button in the UI today, so an admin should:
1. Sign in as **Admin**, go to **Users → User Accounts**.
2. Find the teacher and note their email.
3. The cleanest path is to have the teacher use Firebase's password-reset flow, or contact support to reset the auth password directly in the Firebase Console (**Authentication → Users → select the user → reset password**).
4. Once the password is reset, the teacher signs in and changes it.

> Passwords are never stored in plain text and are never shown to anyone, including admins.

---

## 9. Quick reference: who can do what

| Task | Admin | Teacher | Bursar |
|------|-------|---------|--------|
| Setup wizard (first time) | ✅ | — | — |
| School settings & logo | ✅ | — | — |
| Import students (SchoolPay) | ✅ | — | — |
| Create teacher/bursar accounts | ✅ | — | — |
| Create exams | ✅ | ✅ | — |
| Enter marks | ✅ | ✅ | — |
| Record project work | ✅ | ✅ | — |
| Print report cards | ✅ | ✅ | — |
| Print broadsheets | ✅ | ✅ | — |
| Record fees / payments | ✅ | — | ✅ |
| Payroll & expenses | ✅ | — | ✅ |
| Export backup | ✅ | — | — |

---

## 10. Golden rules

- **Nothing is ever deleted.** Students are marked inactive, not removed.
- **Blank marks are not zero.** Leave a mark blank if a student was absent.
- **SAVE marks as you go.** Entering marks without saving is lost if you navigate away.
- **Keep admin credentials safe.** Only an admin can create accounts and export backups.
- **Back up before term ends.** Use **Settings → Export data** at least once per term.
