/**
 * MIGRATION SCRIPT — set `assessmentMode` on classes (LEGACY / NLSC)
 * ==================================================================
 *
 * Source of truth: Parliament statement of 20 Feb 2025 (Minister Peter Ogwang)
 * — UNEB competence-based grading for NLSC classes (S1–S4).
 *
 * Behaviour:
 *   - DRY-RUN by default. Reports what would change; writes NOTHING.
 *   - Dry-run works offline: if Firestore can't be reached (or isn't
 *     configured), it shows the year-based theoretical plan.
 *   - Pass --write to actually apply changes (requires Firebase + network).
 *   - Before any write, exports/backs up every affected collection to
 *     backups/migrate-<timestamp>/ as JSON files.
 *   - NEVER rewrites existing marks, results, grades or student data.
 *   - Only writes the `assessmentMode` field on `classes` docs (and seeds
 *     grading_settings with placeholder bands if missing).
 *
 * Mode rule:
 *   - If a class already has assessmentMode stored -> keep it (report only).
 *   - Else current-year S1–S4 -> NLSC; everything else -> LEGACY.
 *
 * Usage:
 *   node src/scripts/migrateAssessmentMode.js            # dry run (offline-safe)
 *   FIREBASE_* env vars set  node src/scripts/migrateAssessmentMode.js --write
 *
 * Firebase config (needed for --write; optional for dry-run):
 *   FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID,
 *   FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID
 *   (or a .env file in the project root with VITE_FIREBASE_* keys)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Config loading (.env with VITE_FIREBASE_* or plain FIREBASE_* keys)
// ─────────────────────────────────────────────────────────────────────────────

function loadEnv() {
  const env = {};
  try {
    const text = readFileSync(join(process.cwd(), '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  } catch (e) {
    // .env optional
  }
  return { ...env, ...process.env };
}

const env = loadEnv();

const firebaseConfig = {
  apiKey:            env.VITE_FIREBASE_API_KEY    || env.FIREBASE_API_KEY,
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN|| env.FIREBASE_AUTH_DOMAIN,
  projectId:         env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID,
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET || env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || env.FIREBASE_MESSAGING_SENDER_ID,
  appId:             env.VITE_FIREBASE_APP_ID     || env.FIREBASE_APP_ID,
};

const firebaseConfigured = Boolean(
  firebaseConfig.projectId && firebaseConfig.apiKey && firebaseConfig.appId
);

const MODES = { LEGACY: 'LEGACY', NLSC: 'NLSC' };
const NLSC_CLASSES = ['S1', 'S2', 'S3', 'S4'];
const ALL_CLASSES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
const COLLECTIONS_TO_BACKUP = ['students', 'classes', 'exams', 'exam_results', 'config', 'gradingSettings', 'projectWork'];

const CURRENT_YEAR = env.MIGRATION_ACADEMIC_YEAR || currentAcademicYear();

function currentAcademicYear() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const start = m >= 2 ? y : y - 1;
  return `${start}/${start + 1}`;
}

function isYearBasedNLSC(classLevel, academicYear) {
  if (!NLSC_CLASSES.includes(classLevel)) return false;
  if (!academicYear || !CURRENT_YEAR) return false;
  return academicYear === CURRENT_YEAR;
}

function resolveMode(classLevel, academicYear, storedMode) {
  if (storedMode) {
    const m = String(storedMode).toUpperCase();
    if (m === MODES.LEGACY || m === MODES.NLSC) return m;
  }
  return isYearBasedNLSC(classLevel, academicYear) ? MODES.NLSC : MODES.LEGACY;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeout helper so the script never hangs on an unreachable Firestore
// ─────────────────────────────────────────────────────────────────────────────

const FIRESTORE_TIMEOUT_MS = 12000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Firestore operation timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ─────────────────────────────────────────────────────────────────────────────
// Theoretical (offline) plan — year-based rule only
// ─────────────────────────────────────────────────────────────────────────────

function theoreticalPlan(academicYear) {
  return ALL_CLASSES.map((classLevel) => ({
    classLevel,
    academicYear,
    storedMode: null,
    targetMode: resolveMode(classLevel, academicYear, null),
    willChange: true,
    reason: isYearBasedNLSC(classLevel, academicYear)
      ? 'current-year S1–S4 -> NLSC'
      : 'everything else -> LEGACY',
    note: 'No live classes data; stored-mode overrides require Firestore.',
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Firestore (lazy, own app instance — standalone script)
// ─────────────────────────────────────────────────────────────────────────────

let db;
let firestoreReady = false;
let firestoreError = null;

async function initFirestore() {
  if (firestoreReady || firestoreError) return;
  if (!firebaseConfigured) {
    firestoreError = new Error('Firebase not configured.');
    return;
  }
  try {
    const { initializeApp } = await import('firebase/app');
    const { initializeFirestore } = await import('firebase/firestore');
    const app = initializeApp(firebaseConfig);
    db = initializeFirestore(app, { localCache: undefined });
    firestoreReady = true;
  } catch (e) {
    firestoreError = e;
  }
}

async function getAllDocs(col) {
  await initFirestore();
  if (!firestoreReady) throw firestoreError || new Error('Firestore unavailable.');
  const { getDocs, collection } = await import('firebase/firestore');
  const snap = await withTimeout(getDocs(collection(db, col)), FIRESTORE_TIMEOUT_MS);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function setDocWithId(col, id, data) {
  await initFirestore();
  if (!firestoreReady) throw firestoreError || new Error('Firestore unavailable.');
  const { setDoc, doc } = await import('firebase/firestore');
  await withTimeout(setDoc(doc(db, col, id), data), FIRESTORE_TIMEOUT_MS);
  return { id, ...data };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup / export (requires live Firestore)
// ─────────────────────────────────────────────────────────────────────────────

function backupDir() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(process.cwd(), 'backups', `migrate-${ts}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function backupCollections(cols) {
  await initFirestore();
  if (!firestoreReady) throw new Error('Cannot backup: Firestore unavailable.');
  const dir = backupDir();
  const manifest = { createdAt: new Date().toISOString(), collections: {} };
  for (const col of cols) {
    try {
      const docs = await getAllDocs(col);
      writeFileSync(join(dir, `${col}.json`), JSON.stringify(docs, null, 2));
      manifest.collections[col] = { count: docs.length, file: `${col}.json` };
      console.log(`[backup] ${col}: ${docs.length} docs`);
    } catch (e) {
      console.error(`[backup] ${col}: FAILED — ${e.message}`);
      manifest.collections[col] = { error: e.message };
    }
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[backup] manifest -> ${dir}`);
  return dir;
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration plan (live if Firestore reachable, else theoretical)
// ─────────────────────────────────────────────────────────────────────────────

export async function planMigration() {
  const academicYear = CURRENT_YEAR;

  let live = false;
  let students = [], classes = [], config = [];
  if (firebaseConfigured) {
    await initFirestore();
    if (firestoreReady) {
      try {
        students = await getAllDocs('students').catch(() => []);
        classes  = await getAllDocs('classes').catch(() => []);
        config   = await getAllDocs('config').catch(() => []);
        live = true;
      } catch (e) {
        console.log(`[warn] Firestore reads failed: ${e.message}. Falling back to theoretical plan.`);
      }
    } else {
      console.log(`[warn] ${firestoreError.message}. Falling back to theoretical plan.`);
    }
  } else {
    console.log('[info] Firebase not configured — showing theoretical year-based plan only.');
  }

  if (!live) {
    return { academicYear, offline: true, plan: theoreticalPlan(academicYear) };
  }

  const appConfig = config.find((c) => c.type === 'config' || c.setupComplete !== undefined) || {};
  const year = appConfig.academicYear || academicYear;

  const storedByKey = {};
  (classes || []).forEach((c) => {
    storedByKey[`${c.classLevel}|${c.academicYear}`] = c.assessmentMode;
  });

  const keys = new Set();
  students.forEach((s) => keys.add(`${s.classLevel}|${s.academicYear || year}`));
  (classes || []).forEach((c) => keys.add(`${c.classLevel}|${c.academicYear}`));

  const plan = [];
  for (const key of [...keys].sort()) {
    const [classLevel, y] = key.split('|');
    const stored = storedByKey[key];
    const target = resolveMode(classLevel, y, stored);
    plan.push({
      classLevel,
      academicYear: y,
      storedMode: stored || null,
      targetMode: target,
      willChange: Boolean(!stored || stored !== target),
      reason: stored ? 'already stored (kept)'
        : isYearBasedNLSC(classLevel, y) ? 'current-year S1–S4 -> NLSC'
        : 'everything else -> LEGACY',
    });
  }
  return { academicYear: year, offline: false, plan };
}

export async function applyMigration({ write = false } = {}) {
  if (!write) {
    console.log('=== DRY RUN (no writes). Pass --write to apply. ===\n');
  }

  const { academicYear, offline, plan } = await planMigration();

  console.log(`Academic year used: ${academicYear}`);
  if (offline) console.log('(offline theoretical plan)');
  console.log(`\nClass mode plan (${plan.length} class/year combos):`);

  let nChanges = 0;
  for (const p of plan) {
    const mark = p.willChange ? '  CHANGE' : '      ok';
    console.log(`${mark} ${p.classLevel} ${p.academicYear}: ${p.storedMode ?? '(unset)'} -> ${p.targetMode}  (${p.reason})`);
    if (p.willChange) nChanges++;
  }
  console.log(`\nClasses that would change mode: ${nChanges}`);

  if (!write) {
    console.log('\nDry run complete. No data was written.');
    return { dryRun: true, academicYear, offline, plan, changes: nChanges };
  }

  // ---- WRITE PATH (requires live Firestore) ----
  if (offline) {
    throw new Error('--write requires a reachable Firestore. Configure Firebase and ensure network access.');
  }

  console.log('\n>>> BACKING UP affected collections before writing...');
  const backupPath = await backupCollections(COLLECTIONS_TO_BACKUP);

  await initFirestore();
  let nWritten = 0;
  const now = new Date().toISOString();
  for (const p of plan) {
    if (!p.willChange && p.storedMode) continue;
    const id = `class_${p.classLevel}_${p.academicYear}`;
    let existing;
    try {
      existing = (await getAllDocs('classes')).find((r) => r.id === id);
    } catch (e) {
      console.error(`[write] ${id}: SKIPPED (read failed: ${e.message})`);
      continue;
    }
    const docData = {
      type:          'class',
      classLevel:    p.classLevel,
      academicYear:  p.academicYear,
      assessmentMode: p.targetMode,
      streams:       existing ? existing.streams : [],
      updatedAt:     now,
      ...(existing ? {} : { createdAt: now }),
    };
    try {
      await setDocWithId('classes', id, docData);
      nWritten++;
      console.log(`[write] ${id} assessmentMode = ${p.targetMode}`);
    } catch (e) {
      console.error(`[write] ${id}: FAILED — ${e.message}`);
    }
  }

  // Seed grading_settings if missing (placeholder bands, VERIFY WITH UNEB)
  try {
    const settingsExists = (await getAllDocs('config')).some((d) => d.id === 'grading_settings');
    if (!settingsExists) {
      const seed = {
        type: 'grading_settings',
        version: 1,
        caWeight: 0.2,
        examWeight: 0.8,
        certificateRule: { minSubjectsAtDOrAbove: 1 },
        gradeBands: [
          { letter: 'A', min: 80, descriptor: 'exceptional',   note: 'VERIFY WITH UNEB' },
          { letter: 'B', min: 65, descriptor: 'outstanding',   note: 'VERIFY WITH UNEB' },
          { letter: 'C', min: 50, descriptor: 'satisfactory',  note: 'VERIFY WITH UNEB' },
          { letter: 'D', min: 35, descriptor: 'basic',         note: 'VERIFY WITH UNEB' },
          { letter: 'E', min: 0,  descriptor: 'elementary',    note: 'VERIFY WITH UNEB' },
        ],
        createdAt: now,
        updatedAt: now,
      };
      await setDocWithId('config', 'grading_settings', seed);
      console.log('[write] config/grading_settings seeded (placeholders — VERIFY WITH UNEB)');
    }
  } catch (e) {
    console.error(`[write] grading_settings seed: FAILED — ${e.message}`);
  }

  console.log(`\n>>> Migration complete. ${nWritten} class(es) updated. Backup: ${backupPath}`);
  return { dryRun: false, academicYear, offline, plan, changes: nWritten, backupPath };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const write = process.argv.includes('--write') || process.argv.includes('-w');

applyMigration({ write })
  .then(() => {
    // Ensure the process exits cleanly (no pending Firestore handles keep it alive).
    if (!write) process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
