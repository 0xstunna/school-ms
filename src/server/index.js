/**
 * SERVER-ONLY — Trusted server runtime for Alama multi-tenant SaaS.
 *
 * This is the entry point for the Node.js host that runs the Firebase Admin
 * SDK and exposes authenticated HTTP endpoints for:
 *   POST /api/switch-school     — authenticated active-school switching
 *   POST /api/provision-school  — platform-admin-only school provisioning
 *   POST /api/onboard-school    — self-service school onboarding
 *   GET  /api/health            — health check
 *
 * The Firebase Admin SDK (service-account credential) is NEVER bundled into
 * the browser/Electron client bundle (see vite.config.js external: firebase-admin).
 * All client-facing code talks to Firebase through the client SDK only.
 *
 * Intended hosts (development and production):
 *   - Node.js process (this file), e.g. `node src/server/index.js`
 *   - Cloud Functions for Firebase (adapt the handlers to onRequest)
 *   - Vercel / serverless (export the Express app as a handler)
 *
 * Environment variables (never committed; set in the server host, not VITE_):
 *   FIREBASE_PROJECT_ID   — Firebase project ID (required)
 *   GOOGLE_APPLICATION_CREDENTIALS  — path to service-account JSON, or
 *   FIREBASE_SERVICE_ACCOUNT        — inline service-account JSON
 *   PORT                  — server listen port (default 3001)
 *   NODE_ENV              — development | production
 */

import express from 'express';
import { initAdminApp, getAdminAuth, getAdminDb } from './admin.js';
import { switchActiveSchool } from './switchSchool.js';
import {
  provisionSchool,
  setActiveSchoolClaims,
  onboardSchool,
} from './provisioning.js';

const PORT = Number(process.env.PORT) || 3001;
const app = express();

// ── JSON body parser (limited payload size to discourage abuse) ─────────────
app.use(express.json({ limit: '100kb' }));

// ── Request logging (dev) ───────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`[server] ${req.method} ${req.originalUrl} - ${new Date().toISOString()}`);
    next();
  });
}

// ── Secure Firebase Admin SDK initialization ────────────────────────────────
// The Admin SDK is initialized lazily on first use (getAdminAuth / getAdminDb).
// Credentials come from the server host environment ONLY:
//   GOOGLE_APPLICATION_CREDENTIALS  (service-account file path) or
//   FIREBASE_SERVICE_ACCOUNT        (inline service-account JSON) or
//   platform default service account (Cloud Functions / Cloud Run).
// The service account is NEVER read by the browser/Electron client.
let adminInitialized = false;
let adminInitError = null;

function ensureAdminInitialized() {
  if (adminInitialized || adminInitError) return;
  adminInitialized = true;
  try {
    initAdminApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    console.log('[server] Firebase Admin SDK initialized (project: ' +
      (process.env.FIREBASE_PROJECT_ID || '<default>') + ')');
  } catch (e) {
    adminInitError = e;
    console.error('[server] Firebase Admin SDK initialization failed:',
      e.message, '| Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION MIDDLEWARE
// Verifies the Firebase ID token sent as `Authorization: Bearer <idToken>`.
// Attaches the decoded token to req.user. Endpoints that need the caller's UID
// read it from req.user.uid (cryptographically bound to the real user).
// ─────────────────────────────────────────────────────────────────────────────

async function requireAuth(req, res, next) {
  ensureAdminInitialized();
  if (adminInitError) {
    return res.status(503).json({
      error: 'Server authentication unavailable.',
      code: 'admin_not_initialized',
    });
  }
  const authHeader = req.headers && req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }
  const idToken = authHeader.slice(7).trim();
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired ID token.', code: 'invalid_id_token' });
  }
  req.user = decoded; // { uid, email, ... }
  req.idToken = idToken;
  next();
}

// Platform-administrator authorization. Requires a verified req.user first.
async function requirePlatformAdmin(req, res, next) {
  try {
    const caller = await getAdminAuth().getUser(req.user.uid);
    const claims = caller.customClaims || {};
    if (claims.platformAdmin !== true) {
      return res.status(403).json({
        error: 'Platform administrator access required.',
        code: 'platform_admin_required',
      });
    }
    next();
  } catch (e) {
    return res.status(500).json({ error: 'Platform-admin authorization check failed.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// Health check — no auth, no Admin SDK call (safe to hit before init).
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'alama-server',
    adminInitialized: !!adminInitialized && !adminInitError,
    timestamp: new Date().toISOString(),
  });
});

// POST /api/switch-school
// Authenticated active-school switching. The server verifies the ID token,
// authorises membership in the destination school, verifies the school is
// operational, updates the profile, and re-issues custom claims. The client
// never writes its own claims.
app.post('/api/switch-school', requireAuth, async (req, res) => {
  try {
    const { schoolId } = req.body || {};
    if (!schoolId || typeof schoolId !== 'string') {
      return res.status(400).json({ error: 'schoolId is required.', code: 'missing_school_id' });
    }

    const result = await switchActiveSchool(req.idToken, schoolId);

    console.log(`[server] switch-school ok uid=${result.uid} schoolId=${result.schoolId}`);
    return res.status(200).json({
      ok: true,
      uid: result.uid,
      schoolId: result.schoolId,
      claims: result.claims,
      profile: result.profile,
    });
  } catch (e) {
    const status = /Invalid or expired|required|not found/i.test(e.message) ? 400 : 403;
    console.error(`[server] switch-school failed uid=${req.user && req.user.uid}:`, e.message);
    return res.status(status).json({ ok: false, error: e.message });
  }
});

// POST /api/provision-school
// Platform-administrator-only school provisioning. Creates a new school tenant
// and its first administrator membership, entirely server-side.
app.post('/api/provision-school', requireAuth, requirePlatformAdmin, async (req, res) => {
  try {
    const { schoolData } = req.body || {};
    if (!schoolData || typeof schoolData !== 'object') {
      return res.status(400).json({ error: 'schoolData is required.', code: 'missing_school_data' });
    }

    const result = await provisionSchool(schoolData, req.user.uid);

    console.log(`[server] provision-school ok uid=${req.user.uid} schoolId=${result.schoolId} ` +
      `provisioner=${req.user.uid}`);
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error(`[server] provision-school failed uid=${req.user && req.user.uid}:`, e.message);
    const status = /Only a platform administrator|not found|already exists|required/i.test(e.message)
      ? 400 : 500;
    return res.status(status).json({ ok: false, error: e.message });
  }
});

// POST /api/onboard-school
// Self-service school onboarding. No authenticated caller is required — this is
// how a brand-new school signs itself up and creates its first administrator.
// Duplicate submissions are prevented via idempotency key + email checks.
app.post('/api/onboard-school', async (req, res) => {
  try {
    const { schoolData, idempotencyKey } = req.body || {};
    if (!schoolData || typeof schoolData !== 'object') {
      return res.status(400).json({ error: 'schoolData is required.', code: 'missing_school_data' });
    }
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      return res.status(400).json({ error: 'idempotencyKey is required.', code: 'missing_idempotency_key' });
    }

    const result = await onboardSchool(schoolData, idempotencyKey);

    console.log(`[server] onboard-school ok schoolId=${result.schoolId} ` +
      `alreadyOnboarded=${result.alreadyOnboarded}`);
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error('[server] onboard-school failed:', e.message);
    const status = /already exists|required|unique/i.test(e.message) ? 400 : 500;
    return res.status(status).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 404 handler + centralized error handler
// ─────────────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.', code: 'not_found' });
});

app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.', code: 'internal_error' });
});

// Only listen when this file is run directly (not imported by tests/serverless).
const isMain = process.argv[1] && process.argv[1].endsWith('src/server/index.js');
if (isMain) {
  app.listen(PORT, () => {
    console.log(`[server] Alama trusted server listening on http://localhost:${PORT}`);
    console.log(`[server] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[server] Endpoints:`);
    console.log(`[server]   GET  http://localhost:${PORT}/api/health`);
    console.log(`[server]   POST http://localhost:${PORT}/api/switch-school   (authenticated)`);
    console.log(`[server]   POST http://localhost:${PORT}/api/provision-school   (platform admin)`);
    console.log(`[server]   POST http://localhost:${PORT}/api/onboard-school    (self-service)`);
  });
}

export { app };
