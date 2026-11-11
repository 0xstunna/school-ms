# Alama — Provisioning Security & Bootstrap

This document describes the security model for server-side school provisioning,
platform administrator establishment, and the isolation of the Firebase Admin SDK
from the browser bundle. It is the design basis for `src/server/provisioning.js`
and `src/server/admin.js`.

---

## 1. First Platform Administrator — Secure Establishment

There is **no client-side or public endpoint** for creating the first platform
administrator. Platform administrator privileges (`platformAdmin: true`) can only
be assigned server-side via the Firebase Admin SDK. The bootstrap procedure is:

### Bootstrap Procedure

1. **Provision the platform Firebase project** — a single shared Firebase project
   for the entire SaaS platform (separate from any per-school development
   project). Obtain a service-account credential with Admin SDK privileges.

2. **Create the first platform admin account** — using the Admin SDK
   (`auth.createUser()`), create a Firebase Auth account for the inaugural
   platform administrator. This is done through a secure server-side bootstrap
   script (see `src/scripts/bootstrapPlatformAdmin.js`), never through the
   browser or a public API.

3. **Write the platform admin's Firestore profile** — create `users/{uid}` with
   `platformAdmin: true`, `role: 'admin'`, `active: true`, and an empty
   `schoolIds: []` (platform admins do not automatically receive academic access
   to any school; they must be explicitly granted a membership if they need to
   manage a school's data — least privilege).

4. **Set platform admin custom claims** — call
   `auth.setCustomUserClaims(uid, { schoolId: null, role: 'admin', am: false,
   active: true, platformAdmin: true })`. The `platformAdmin` claim is the
   runtime authority that Firestore rules consult.

5. **Store the bootstrap record** — the bootstrap script writes an audit entry
   (e.g. to `platformAdmins/{uid}` or a secure log) recording who performed the
   bootstrap and when, for accountability.

### Bootstrap Script

A bootstrap CLI script (`src/scripts/bootstrapPlatformAdmin.js`) is provided
for this purpose. It:

- Initializes the Admin SDK from `GOOGLE_APPLICATION_CREDENTIALS` or explicit
  service-account options.
- Creates (or recovers) the Firebase Auth account.
- Writes the `users/{uid}` profile with `platformAdmin: true`.
- Sets the custom claims.
- Exits with a non-zero status if any step fails (no partial state left behind;
  the Admin SDK account creation is rolled back by deleting the Auth user if the
  Firestore write fails).

The bootstrap script must be run in a secure environment (CI/CD pipeline,
administrator workstation, or platform operations console) with the service
account credential available only to authorized operators.

---

## 2. Granting and Revoking Platform Administrator Privileges

### Granting

Platform administrator privileges are granted **server-side only** via the Admin
SDK:

```js
await auth.setCustomUserClaims(uid, {
  ...existingClaims,
  platformAdmin: true,
});
await db.collection('users').doc(uid).update({ platformAdmin: true });
```

The Firestore rules enforce that `platformAdmin` can never be set or changed by
a client:

```js
function touchesPlatformAdmin() {
  return request.resource.data.diff(resource.data)
    .affectedKeys().hasAny(['platformAdmin']);
}
// platformAdmin updates are rejected on users/{userId} unless the caller is
// already a platform admin (allow update: if isPlatformAdmin()).
```

### Revoking

Revocation follows the same server-side pattern:

```js
await auth.setCustomUserClaims(uid, {
  ...existingClaims,
  platformAdmin: false,
});
await db.collection('users').doc(uid).update({ platformAdmin: false });
```

When `platformAdmin` is revoked, the user's existing ID token retains the claim
until it expires (maximum 1 hour). To force immediate revocation, call
`auth.revokeRefreshTokens(uid)` to invalidate all sessions, requiring the user
to sign in again.

### Separation from School Administrator

A platform administrator is **distinct** from a school administrator:

| | Platform administrator | School administrator |
|---|---|---|
| Scope | Entire platform | One school |
| Claim | `platformAdmin: true` | `role: 'admin'` for that school |
| Academic access | None by default (must be granted membership) | Own school's data only |
| Can grant platformAdmin? | Yes (server-side) | No — client rules reject |

---

## 3. Provisioning Authorization

`provisionSchool(schoolData, provisionerUid)` is the sole server-side entry
point for creating a new school tenant. Authorization works as follows:

### Step 1 — Provisioner Authorization

Before any provisioning work begins, the function verifies that the
`provisionerUid` corresponds to a Firebase Auth account with
`platformAdmin: true` in its custom claims:

```js
const provisioner = await auth.getUser(provisionerUid);
if (provisionerClaims.platformAdmin !== true) {
  throw new Error('Only a platform administrator can provision a school.');
}
```

This is the **gatekeeper**: no platform admin claim = no provisioning, before
any validation or resource creation.

### Step 2 — Input Validation

All school and first-admin inputs are validated before any resource is created:

| Field | Validation |
|---|---|
| `schoolName` | Required, non-empty string |
| `adminFullName` | Required, non-empty string |
| `adminEmail` | Required, valid email format |
| `adminPassword` | Required, >= 8 characters |
| `academicYear` | Required, non-empty string |
| `currentTerm` | Required, non-empty string |
| `plan` | Must be one of: `trial`, `starter`, `school` |
| `schoolEmail` | Optional, but if provided must be valid email |

### Step 3 — Duplicate Prevention

Before creating any resources, the function checks for collisions:

- **School email**: `auth.getUserByEmail(schoolEmail)` — throws if an Auth
  account already exists with that email.
- **Admin email**: `auth.getUserByEmail(adminEmail)` — throws if an Auth
  account already exists with that email.
- **School ID**: derived from the school name via `slugify()`; if the slug
  already exists as a `schools/{schoolId}` document, a counter-suffixed
  variant (`sch_name_1`, `sch_name_2`, ...) is used.

These checks prevent duplicate schools, duplicate admin accounts, and email
squatting.

---

## 4. Partial Failure Rollback

`provisionSchool` creates multiple resources across Firebase Auth and Firestore:

1. `schools/{schoolId}` — tenant root document
2. `auth.createUser()` — first admin's Firebase Auth account
3. `users/{uid}` — first admin's Firestore profile
4. `auth.setCustomUserClaims()` — first admin's custom claims
5. `schools/{schoolId}/config/setup` — per-school setup flag

If **any step fails after step 1**, the `rollback()` function attempts
best-effort cleanup of everything created so far:

| Resource | Rollback Action |
|---|---|
| `users/{uid}` profile | `db.collection('users').doc(uid).delete()` |
| Firebase Auth account | `auth.deleteUser(uid)` |
| `schools/{schoolId}` | `db.collection('schools').doc(schoolId).delete()` |

Rollback errors are logged but not allowed to mask the original provisioning
error — the original error is re-thrown after cleanup attempts.

**Important:** `auth.setCustomUserClaims()` (step 4) has no rollback because
claims are not a persistent resource — they are a JWT property that expires.
If claim setting fails, the Auth user and profile are still rolled back, so
no orphaned account with stale claims remains.

---

## 5. Duplicate Provisioning Requests

Duplicate provisioning is prevented at two levels:

### Application-level (in `provisionSchool`)

- **Email uniqueness**: Both the school email and the first-admin email are
  checked against Firebase Auth before account creation. If either already
  exists, the function throws before creating any resources.
- **School ID uniqueness**: The slug is checked against existing
  `schools/{schoolId}` documents. If it exists, a counter-suffixed variant is
  generated automatically.

### Idempotency

`provisionSchool` is **not idempotent** — calling it twice with the same admin
email will fail on the second call because the admin email already exists. This
is intentional: duplicate provisioning should be a visible error, not a silent
no-op, so operators are aware of the conflict.

If a caller needs to retry after a partial failure (where rollback succeeded),
they can call `provisionSchool` again with the same inputs — the email checks
will pass because the previous attempt was fully rolled back.

---

## 6. Admin SDK Isolation from Browser Bundle

The Firebase Admin SDK (`firebase-admin`) must **never** be bundled into the
browser or Electron client. It contains service-account credentials and
privileged operations (`createUser`, `setCustomUserClaims`, `deleteUser`, etc.)

### Isolation Mechanism

**`vite.config.js`** externalizes `firebase-admin` from the Vite rollup bundle:

```js
build: {
  rollupOptions: {
    external: ['firebase-admin'],
  },
},
```

This ensures that `firebase-admin` is marked as external in the client bundle.
If any client-side code attempts to `import` from `firebase-admin`, Vite will
not bundle it — the import will remain unresolved at runtime, causing a clear
error rather than silently embedding Admin SDK code in the browser.

### Module Separation

- **`src/server/admin.js`** — Admin SDK initialization. Exports `initAdminApp`,
  `getAdminAuth`, `getAdminDb`. Imported **only** by server-side code
  (provisioning.js, bootstrap scripts, future Cloud Functions).
- **`src/server/provisioning.js`** — `provisionSchool()` and
  `setActiveSchoolClaims()`. Imports from `./admin.js`. Never imported by
  client code.
- **`src/db/firebase.js`** — Client SDK initialization (`firebase/app`,
  `firebase/auth`, `firebase/firestore`). Used by all client-side code.
- **`src/lib/memberships.js`** — Pure JS, no Firebase dependencies. Safe to
  import from both client and server.

### Build-Time Guard

The `npm run build` step succeeds only if `firebase-admin` is not bundled into
the client chunk. The external declaration in `vite.config.js` is the
enforcement point. No client-side test or runtime check can substitute for
build-time externalization.

---

## 7. Threat Model Summary

| Threat | Mitigation |
|---|---|
| Client forges custom claims | Claims are set server-side via Admin SDK; JWTs are signed by Firebase Auth |
| Client provisions a school | `provisionSchool` is server-only; not in browser bundle; `platformAdmin` claim required |
| Client escalates to platform admin | Firestore rules reject client writes to `platformAdmin` on `users/{uid}` |
| Client switches another user's school | `setActiveSchoolClaims` requires `callerUid === uid` or `platformAdmin` claim |
| Duplicate school creation | Email uniqueness checks + school ID collision detection |
| Partial provisioning leaves orphaned state | `rollback()` cleans up Auth users, profiles, and school docs |
| Admin SDK in browser bundle | `vite.config.js` `external: ['firebase-admin']` |
| Stale claims after platform admin revocation | `auth.revokeRefreshTokens(uid)` invalidates all sessions |

---

## 8. What Is NOT Implemented (Deliberate)

- **No public registration endpoint** — school creation requires a platform
  administrator with `platformAdmin: true`.
- **No client-side Admin SDK** — `firebase-admin` is externalized from the
  browser bundle.
- **No self-service signup** — users cannot create schools or grant themselves
  platform administrator privileges.
- **No email invitation flow** — the first admin's password is set during
  provisioning; subsequent user management is school-scoped.
