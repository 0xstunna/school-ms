/**
 * BOOTSTRAP SCRIPT — Create the first platform administrator.
 *
 * SERVER-ONLY. Run in a secure environment with the Admin SDK service account
 * credential available via GOOGLE_APPLICATION_CREDENTIALS or explicit options.
 *
 * This script establishes the inaugural platform administrator. It is run once
 * (or as needed to recover access) and is NOT part of the application runtime.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json \
 *   node src/scripts/bootstrapPlatformAdmin.js \
 *     --email admin@platform.example.com \
 *     --password <secure-password> \
 *     --fullName "Platform Admin"
 *
 * The script:
 *   1. Initializes the Firebase Admin SDK.
 *   2. Creates (or recovers) the Firebase Auth account.
 *   3. Writes the users/{uid} profile with platformAdmin: true.
 *   4. Sets custom claims (platformAdmin: true).
 *   5. Rolls back (deletes the Auth user) if the Firestore write fails.
 *
 * No public registration endpoint is exposed. Platform administrator
 * privileges can only be established through this server-side bootstrap.
 */

import { initAdminApp, getAdminAuth, getAdminDb } from '../server/admin.js';

const COL_USERS = 'users';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email' && argv[i + 1]) { args.email = argv[++i]; }
    else if (a === '--password' && argv[i + 1]) { args.password = argv[++i]; }
    else if (a === '--fullName' && argv[i + 1]) { args.fullName = argv[++i]; }
  }
  return args;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email || !isValidEmail(args.email)) {
    console.error('Error: --email is required and must be a valid email address.');
    process.exit(1);
  }
  if (!args.password || args.password.length < 8) {
    console.error('Error: --password is required and must be at least 8 characters.');
    process.exit(1);
  }
  if (!args.fullName || args.fullName.trim().length === 0) {
    console.error('Error: --fullName is required.');
    process.exit(1);
  }

  const email = args.email.toLowerCase().trim();
  const fullName = args.fullName.trim();

  // Initialize Admin SDK from GOOGLE_APPLICATION_CREDENTIALS or platform default.
  const { adminAuth, adminDb } = initAdminApp();

  let authUid = null;

  try {
    // 1. Create (or recover) the Firebase Auth account.
    let authRecord;
    try {
      authRecord = await adminAuth.createUser({
        email,
        password: args.password,
        displayName: fullName,
        emailVerified: false,
      });
      console.log(`[bootstrap] Created Firebase Auth account: ${authRecord.uid}`);
    } catch (e) {
      if (e.code === 'auth/email-already-in-use') {
        // Recover: sign in is not possible via Admin SDK; get the user by email.
        const user = await adminAuth.getUserByEmail(email);
        authRecord = user;
        console.log(`[bootstrap] Auth account already exists: ${authRecord.uid}`);
      } else {
        throw e;
      }
    }
    authUid = authRecord.uid;

    // 2. Write the Firestore profile with platformAdmin: true.
    const now = new Date().toISOString();
    const profile = {
      type:              'user',
      uid:               authUid,
      fullName,
      email,
      role:              'admin',
      schoolId:          null,        // platform admin has no active school
      schoolIds:         [],
      membershipActive:  {},
      active:            true,
      platformAdmin:     true,
      assignedClasses:   [],
      createdBy:         'bootstrap',
      createdAt:         now,
      updatedAt:         now,
    };
    await adminDb.collection(COL_USERS).doc(authUid).set(profile);
    console.log(`[bootstrap] Wrote Firestore profile: users/${authUid}`);

    // 3. Set custom claims (platformAdmin: true).
    await adminAuth.setCustomUserClaims(authUid, {
      schoolId:  null,
      role:      'admin',
      am:        false,
      active:    true,
      platformAdmin: true,
    });
    console.log(`[bootstrap] Set custom claims: platformAdmin=true`);

    console.log(`\n[bootstrap] Platform administrator established: ${email} (${authUid})`);
    console.log('[bootstrap] Save these credentials securely. The platform admin can');
    console.log('[bootstrap] now provision schools via provisionSchool().');
  } catch (e) {
    // Rollback: delete the Auth user if we created it and the Firestore write failed.
    if (authUid) {
      try {
        await adminAuth.deleteUser(authUid);
        console.error(`[bootstrap] Rolled back: deleted Auth user ${authUid}`);
      } catch (delErr) {
        console.error(`[bootstrap] Rollback failed to delete Auth user ${authUid}:`, delErr.message);
      }
    }
    console.error(`[bootstrap] Failed: ${e.message}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`[bootstrap] Fatal: ${e.message}`);
  process.exit(1);
});
