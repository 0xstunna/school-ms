/**
 * SERVER-ONLY — Firebase Admin SDK initialization.
 *
 * This module holds the privileged Firebase Admin SDK. It MUST NOT be imported
 * by any client-side (browser / Electron) module. All client-facing code talks
 * to Firebase through the client SDK in src/db/firebase.js.
 *
 * Intended hosts: Cloud Functions for Firebase, a Node.js container, or any
 * server-side entry point that runs with a service-account credential.
 *
 * Usage:
 *   import { initAdminApp, getAdminAuth, getAdminDb } from './server/admin.js';
 *   initAdminApp({ serviceAccount: serviceAccountJson, projectId: '...' });
 *
 * When no options are passed, the Admin SDK is initialized from the
 * GOOGLE_APPLICATION_CREDENTIALS environment variable (or FIREBASE_* env vars
 * on platforms such as Cloud Functions).
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

let adminApp;
let adminAuth;
let adminDb;

/**
 * Initialize the Admin SDK app. Safe to call multiple times — returns the
 * existing app if one is already initialized.
 *
 * @param {object} options
 * @param {object|string} [options.credential] — Admin SDK credential (service
 *   account object or path). Defaults to Application Default Credentials.
 * @param {string} [options.projectId] — Firebase project ID.
 * @returns {{ adminApp, adminAuth, adminDb }}
 */
export function initAdminApp(options = {}) {
  if (getApps().length > 0) {
    adminApp = getApps()[0];
  } else if (options.credential) {
    adminApp = initializeApp({
      credential: cert(options.credential),
      projectId: options.projectId,
    });
  } else {
    // Rely on Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS
    // or the platform's default service account).
    adminApp = initializeApp({ projectId: options.projectId });
  }
  adminAuth = getAuth(adminApp);
  adminDb = getFirestore(adminApp);
  return { adminApp, adminAuth, adminDb };
}

export function getAdminApp() {
  if (!adminApp) initAdminApp();
  return adminApp;
}

export function getAdminAuth() {
  if (!adminAuth) initAdminApp();
  return adminAuth;
}

export function getAdminDb() {
  if (!adminDb) initAdminApp();
  return adminDb;
}
