/**
 * Alama — Multi-tenant migration script (Task 6)
 *
 * Migrates an existing single-school installation to the multi-tenant
 * architecture:
 *   1. Backs up all academic + config + user data to a JSON file.
 *   2. Creates the tenant root: schools/{schoolId}.
 *   3. Seeds per-school config (schools/{schoolId}/config/{setup,app_config,grading_settings}).
 *   4. Assigns schoolId to existing academic records (students, classes,
 *      subjects, exams, exam_results, projectWork, attendance, staff).
 *   5. Updates user memberships (schoolIds, membershipActive, active school).
 *
 * SAFETY:
 *   - Write mode requires the explicit --confirm-migration flag.
 *   - --dry-run performs no writes; it only reports the plan.
 *   - A full backup is always written before any migration writes.
 *   - The script is idempotent: re-running does not duplicate resources or
 *     re-assign schoolId to records that already carry it.
 *
 * This is a Node.js Admin SDK tool. It is NOT part of the browser/Electron
 * client bundle (firebase-admin is externalized in vite.config.js).
 *
 * Credentials (server host ONLY — never committed, never in the client):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   FIREBASE_PROJECT_ID=<target-project-id>
 *
 * Examples:
 *   node src/scripts/migrateToMultiTenant.js --dry-run
 *   node src/scripts/migrateToMultiTenant.js --school-id sch_myschool --confirm-migration
 */

import { initAdminApp, getAdminDb } from '../server/admin.js';
import { writeFileSync } from 'node:fs';

const COLLECTIONS = [
  'students',
  'classes',
  'subjects',
  'exams',
  'exam_results',
  'projectWork',
  'attendance',
  'staff',
];

const CONFIG_COLLECTION = 'config';
const USERS_COLLECTION = 'users';
const SCHOOLS_COLLECTION = 'schools';

const DEFAULT_PLAN = 'trial';

let dryRun = false;
let confirmMigration = false;
let schoolIdArg = null;
let backupFileArg = null;

function parseArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--confirm-migration') confirmMigration = true;
    else if (a === '--school-id' && i + 1 < args.length) {
      schoolIdArg = args[++i];
    } else if (a === '--backup-file' && i + 1 < args.length) {
      backupFileArg = args[++i];
    } else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.error('Unknown argument:', a);
      printUsage();
      process.exit(1);
    }
  }
}

function printUsage() {
  console.log(`
Alama multi-tenant migration script

Usage:
  node src/scripts/migrateToMultiTenant.js [options]

Options:
  --dry-run              Report the migration plan. No writes are performed.
  --confirm-migration    Safety opt-in: required to actually write migrations.
  --school-id <id>       School ID to assign. Defaults to a generated sch_<ts>_<rand>.
  --backup-file <path>   JSON backup path. Defaults to migration-backup-<ts>.json.
  --help, -h             Show this help.

Safety: write mode requires --confirm-migration. A backup is always written first.
`);
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'school';
}

function nextAvailableSchoolId(db) {
  // Deterministic fallback if no arg provided: sch_<ts>_<rand>.
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `sch_${ts}_${rnd}`;
}

/** Read every document in a collection. */
async function readAllDocs(db, col) {
  const snap = await db.collection(col).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Read a single document or null. */
async function readDoc(db, col, id) {
  const snap = await db.collection(col).doc(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/** Write backup JSON. */
function writeBackup(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`[migration] backup written to ${filePath} (${JSON.stringify(data).length} bytes)`);
}

async function main() {
  parseArgs();

  if (!dryRun && !confirmMigration) {
    console.error('[migration] ERROR: write mode requires --confirm-migration.');
    console.error('[migration] Run with --dry-run first to review the plan.');
    process.exit(1);
  }

  const mode = dryRun ? 'DRY-RUN (no writes)' : 'MIGRATION (writes)';
  console.log(`[migration] Mode: ${mode}`);

  // Initialize Admin SDK against the target project.
  initAdminApp({ projectId: process.env.FIREBASE_PROJECT_ID });
  const db = getAdminDb();

  // ── Resolve schoolId ──
  let schoolId = schoolIdArg;
  let schoolName = null;
  if (!schoolId) {
    // Look for an existing top-level config to derive a default school name.
    const existingConfig = await readDoc(db, CONFIG_COLLECTION, 'app_config');
    schoolName = existingConfig?.schoolName || 'Migrated School';
    schoolId = nextAvailableSchoolId(db);
    console.log(`[migration] Generated schoolId: ${schoolId} (name: ${schoolName})`);
  } else {
    const existing = await readDoc(db, SCHOOLS_COLLECTION, schoolId);
    if (existing) {
      schoolName = existing.schoolName || 'Existing School';
      console.log(`[migration] Reusing existing school: ${schoolId} (${schoolName})`);
    } else {
      schoolName = 'Migrated School';
      console.log(`[migration] New school will be created: ${schoolId}`);
    }
  }

  const now = new Date().toISOString();

  // ── 1. Backup ──
  const backupFile = backupFileArg || `migration-backup-${Date.now().toString(36)}.json`;
  const backup = { collections: {}, config: {}, users: [], schools: [], exportedAt: now };

  if (!dryRun) {
    for (const col of COLLECTIONS) {
      backup.collections[col] = await readAllDocs(db, col);
    }
    const configDocs = await readAllDocs(db, CONFIG_COLLECTION);
    for (const c of configDocs) backup.config[c.id] = c;
    backup.users = await readAllDocs(db, USERS_COLLECTION);
    backup.schools = await readAllDocs(db, SCHOOLS_COLLECTION);
    writeBackup(backupFile, backup);
  } else {
    console.log(`[migration] (dry-run) would back up to ${backupFile}`);
  }

  // ── Plan / report ──
  const counts = {};
  for (const col of COLLECTIONS) {
    const docs = await readAllDocs(db, col);
    counts[col] = docs.length;
    const missingSchoolId = docs.filter((d) => !d.schoolId).length;
    if (missingSchoolId > 0) {
      console.log(`[migration] ${col}: ${docs.length} docs, ${missingSchoolId} need schoolId`);
    }
  }
  const configDocs = await readAllDocs(db, CONFIG_COLLECTION);
  console.log(`[migration] config/: ${configDocs.length} docs to migrate to per-school config`);
  const users = await readAllDocs(db, USERS_COLLECTION);
  console.log(`[migration] users/: ${users.length} profiles to update for membership`);

  if (dryRun) {
    console.log(`\n[migration] DRY-RUN complete. No writes performed.`);
    console.log(`[migration] To apply: node src/scripts/migrateToMultiTenant.js --school-id ${schoolId} --confirm-migration`);
    process.exit(0);
  }

  // ── 2. Create / reuse the school record ──
  const schoolRef = db.collection(SCHOOLS_COLLECTION).doc(schoolId);
  const schoolSnap = await schoolRef.get();
  if (!schoolSnap.exists) {
    await schoolRef.set({
      type: 'school',
      schoolId,
      schoolName,
      schoolSlug: slugify(schoolName),
      status: 'active',
      plan: DEFAULT_PLAN,
      migratedFromSingleTenant: true,
      migratedAt: now,
      updatedAt: now,
    });
    console.log(`[migration] created schools/${schoolId}`);
  } else {
    console.log(`[migration] schools/${schoolId} already exists (reused)`);
  }

  // ── 3. Seed per-school config ──
  const configPath = `${SCHOOLS_COLLECTION}/${schoolId}/config`;
  for (const [docId, config] of Object.entries(backup.config)) {
    const targetRef = db.collection(configPath).doc(docId);
    const targetSnap = await targetRef.get();
    if (targetSnap.exists) {
      console.log(`[migration] ${configPath}/${docId} already exists (skipped)`);
      continue;
    }
    const configData = { ...config, schoolId, migratedAt: now, updatedAt: now };
    await targetRef.set(configData);
    console.log(`[migration] seeded ${configPath}/${docId}`);
  }

  // ── 4. Assign schoolId to academic records ──
  for (const col of COLLECTIONS) {
    const docs = await readAllDocs(db, col);
    let updated = 0;
    for (const docData of docs) {
      if (docData.schoolId) continue; // already migrated (idempotent)
      await db.collection(col).doc(docData.id).update({ schoolId, updatedAt: now });
      updated += 1;
    }
    if (updated > 0) {
      console.log(`[migration] ${col}: assigned schoolId to ${updated} documents`);
    }
  }

  // ── 5. Update user memberships ──
  for (const user of users) {
    const updates = {};
    let changed = false;
    if (!user.schoolId) {
      updates.schoolId = schoolId;
      changed = true;
    }
    const schoolIds = user.schoolIds || [];
    if (!schoolIds.includes(schoolId)) {
      updates.schoolIds = [...schoolIds, schoolId];
      changed = true;
    }
    const membershipActive = user.membershipActive || {};
    if (membershipActive[schoolId] !== true) {
      updates.membershipActive = { ...membershipActive, [schoolId]: true };
      changed = true;
    }
    if (changed) {
      updates.updatedAt = now;
      await db.collection(USERS_COLLECTION).doc(user.uid).update(updates);
      console.log(`[migration] users/${user.uid}: added membership to ${schoolId}`);
    }
  }

  console.log(`\n[migration] Migration complete for school ${schoolId}.`);
  console.log(`[migration] Backup: ${backupFile}`);
  console.log(`[migration] Review results, then deploy firestore.rules if not already deployed.`);
}

main().catch((e) => {
  console.error('[migration] FATAL:', e.message);
  process.exit(1);
});
