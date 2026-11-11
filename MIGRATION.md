# Alama — Multi-Tenant Migration Strategy (Task 6)

This document describes a **documented, repeatable, and safe** migration path for
existing single-school Alama installations to the multi-tenant architecture
introduced in Milestones 2.2 and 3A.

> ⚠️  **Never migrate production data automatically.** Migration is an explicit,
> operator-run operation. It must be preceded by a full backup and run in
> dry-run mode first. There is no auto-migration on app start.

---

## Scope

Academic data only (no fees/payroll/expenses/net-new modules beyond existing):

| Collection | Migrated? | schoolId assigned? |
|------------|-----------|--------------------|
| students   | ✅        | ✅                 |
| classes    | ✅        | ✅                 |
| subjects   | ✅        | ✅                 |
| exams      | ✅        | ✅                 |
| exam_results | ✅      | ✅                 |
| projectWork| ✅        | ✅                 |
| attendance | ✅        | ✅                 |
| staff      | ✅        | ✅                 |
| fee_structures | ⏭️    | (finance, out of scope for 3A) |
| fee_payments | ⏭️     | (finance, out of scope for 3A) |
| payroll    | ⏭️        | (finance, out of scope for 3A) |
| expenses   | ⏭️        | (finance, out of scope for 3A) |
| users      | ✅        | membership added   |
| config/    | ✅        | moved to per-school|
| schools/   | ✅        | tenant root created|

Grading and report generation are preserved unchanged.

---

## Prerequisites

1. A Firebase project (the target multi-tenant project — **not** production
   unless you have explicitly decided to cut over).
2. The Firestore security rules from `firestore.rules` deployed to the target
   project (tenant-isolation rules require `schoolId` on every academic doc).
3. A Firebase service account with Admin SDK privileges (for the migration
   script — **never** exposed to the browser).
4. A full backup of the source data (the script creates one automatically).

---

## Migration script

`src/scripts/migrateToMultiTenant.js`

### Modes

| Flag | Behaviour |
|------|-----------|
| `--dry-run` | Report what would change. **No writes.** Safe to run repeatedly. |
| (no `--dry-run`) | Perform the migration (writes). Requires `--confirm-migration`. |
| `--confirm-migration` | Safety opt-in. Required together with write mode. |
| `--school-id <id>` | The schoolId to assign. Defaults to a generated `sch_<ts>_<rand>`. |
| `--backup-file <path>` | JSON backup path. Defaults to `migration-backup-<ts>.json`. |

### Examples

```bash
# 1. Dry-run first — review the plan, no writes
node src/scripts/migrateToMultiTenant.js --dry-run

# 2. Run the migration (writes) for a specific school
node src/scripts/migrateToMultiTenant.js --school-id sch_myschool --confirm-migration

# 3. Let the script generate a schoolId
node src/scripts/migrateToMultiTenant.js --confirm-migration
```

### Environment

The script uses the Firebase Admin SDK. Provide credentials via one of:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
# or
export FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'
export FIREBASE_PROJECT_ID=<target-project-id>
```

Never commit service-account credentials. They must exist only on the
operator's machine / secure CI.

---

## Migration steps (in order)

1. **Backup** — read every document in every academic collection plus
   `config/` and `users/`, and write them to the backup JSON file. This is the
   rollback source if anything goes wrong.
2. **Create the school** — write `schools/{schoolId}` with `status: 'active'`,
   `schoolName`, `schoolSlug`, academic year/term, plan. If a school doc with
   that id already exists, it is reused (idempotent).
3. **Seed per-school config** — create
   `schools/{schoolId}/config/{setup, app_config, grading_settings}` from the
   top-level `config/` documents (setup flag, app_config values, grading
   settings). Top-level `config/` docs are **not deleted** (they are preserved
   for reference); after migration, reads use the per-school path.
4. **Assign schoolId to academic records** — for every document in
   `students, classes, subjects, exams, exam_results, projectWork, attendance,
   staff`: if it lacks `schoolId`, set `schoolId = <schoolId>`. Docs that
   already carry `schoolId` are left untouched (idempotent).
5. **Update user memberships** — for each `users/{uid}` profile, add
   `schoolId` to `schoolIds` (if missing), set `membershipActive[schoolId] =
   true`, and set the profile's `schoolId` (active school) when it is null.
6. **Verify** — re-read a sample of migrated docs and confirm `schoolId` is
   present and config reads resolve to the per-school path.

### Idempotency

The migration is idempotent: re-running it on the same target school does not
duplicate school docs, config docs, or membership entries, and does not
re-assign `schoolId` to records that already have it. The backup step always
re-exports current state.

### Rollback

There is no automatic rollback after writes. To roll back, restore from the
backup JSON file (the script can re-import backup data into a clean database
as a manual operator procedure). Always run `--dry-run` first to review the
plan.

---

## What is NOT migrated (deferred to later milestones)

- Billing / subscriptions / plans beyond a `plan` field on the school doc.
- Fees, payroll, expenses collections (finance modules remain single-tenant
  until their own migration is planned).
- Platform-admin dashboard UI.
- School registration UI (self-service onboarding is via `/api/onboard-school`).

---

## Browser / Electron builds

The migration script is a Node.js (Admin SDK) tool. It is **not** part of the
browser/Electron client bundle. `vite.config.js` already externalizes
`firebase-admin` so Admin credentials never ship to the client.

Web and Electron builds are unaffected by the migration.

---

## Migration checklist

- [ ] Target Firebase project created (not production unless explicitly cut over)
- [ ] `firestore.rules` deployed to target project
- [ ] Service account credential available (GOOGLE_APPLICATION_CREDENTIALS)
- [ ] `--dry-run` executed and output reviewed
- [ ] Full backup file generated (script does this automatically)
- [ ] Migration executed with `--confirm-migration`
- [ ] Verified: academic docs carry `schoolId`; per-school config reads work
- [ ] Verified: existing students, classes, subjects, exams, marks, reports intact
