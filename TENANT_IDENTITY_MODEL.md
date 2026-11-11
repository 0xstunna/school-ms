# Alama — Tenant Identity Model

This document records the tenant identity and access-control design selected for
Alama's transition to a multi-tenant SaaS platform. It is the design basis for
the Firestore security rules in this milestone.

## 1. Users are identified by Firebase Auth UID

- **Authentication:** Firebase Auth email/password (single platform project).
- **Identity:** `firebaseUser.uid` — a platform-global Auth account that a person
  can use across many schools.
- **Profile:** `users/{uid}` Firestore document, keyed by Auth UID.

## 2. Users belong to schools through membership (not through `schoolId` alone)

A user is linked to one or more schools via membership data carried on the
`users/{uid}` profile and mirrored into Firebase Auth **custom claims** at
sign-in / membership-change time.

### Profile shape (`users/{uid}`)

```js
{
  type: 'user',
  uid,                           // Firebase Auth UID
  fullName, email,
  role: 'admin' | 'teacher' | 'bursar',   // role in the ACTIVE school (transitional)
  schoolId: 'sch_A',             // active (currently selected) school
  schoolIds: ['sch_A', 'sch_B'], // every school the user is a member of
  membershipActive: {            // per-school membership active flag
    sch_A: true,
    sch_B: true,
  },
  active: true,                  // globally active / deactivated
  platformAdmin: false,          // platform administrator (distinct from school admin)
  assignedClasses: [],
  createdBy, createdAt, updatedAt,
}
```

### Custom claims shape (set server-side via Admin SDK)

```js
{
  schoolId: 'sch_A',   // active (currently selected) school — identifies the
                       // tenant whose data this session may read/write
  role: 'admin',       // role in the ACTIVE school (flat; per-school roles live
                       // on the users/{uid} profile, source of truth)
  am: true,            // active membership in the ACTIVE school (true/false)
  active: true,        // globally active / not deactivated
  platformAdmin: false // platform administrator (distinct from school admin)
}
```

**Claims are intentionally small.** They carry only the active school and its
role, plus global flags. Per-school memberships (`schoolIds[]`), per-school role
maps (`roles{}`), and per-school active flags (`membershipActive{}`) live on the
`users/{uid}` profile (source of truth) and are validated server-side when the
active school changes. Claims are refreshed
(`firebaseUser.getIdToken(true)`) after sign-in and after any membership or role
change.

**Why claims stay small:** A user can belong to many schools; enumerating all
school IDs, roles, and membership flags in every ID token would quickly exceed
Firebase's 1,000-byte custom-claims limit. The active-school data in claims is
enough for Firestore rules to enforce `resource.data.schoolId ==
request.auth.token.schoolId` without extra reads. Multi-school membership is
resolved from the `users/{uid}` profile when switching schools or accessing
school-level documents.

## 3. School roles are assigned per school

A user's role is interpreted relative to the active school:
- `role` on the profile / `roles[activeSchoolId]` in claims = the role for the
  active school.
- A user can be `admin` in one school and `teacher` in another.
- Role values: `admin`, `teacher`, `bursar`.

## 4. A user CAN belong to multiple schools

This decision is **explicitly established**: `schoolIds[]` / per-school `roles`
and `membershipActive` support multi-school membership. The app does **not**
assume every user belongs to exactly one school. A user picks an **active**
school (`schoolId`) on login (auto-selected when only one membership exists) and
can switch; switching re-issues claims with the new active school.

## 5. Authoritative source for access

- **Runtime enforcement (Firestore rules):** Firebase Auth custom claims
  (`request.auth.token.schoolId`, `schoolIds`, `roles`, `membershipActive`,
  `active`, `platformAdmin`). Claims are authoritative for the current session
  because they are cryptographically signed by Firebase Auth and cannot be
  forged by the client.
- **Source of truth:** `users/{uid}` profile (plus a `schools/{schoolId}`
  document for school-level status). Claims are regenerated from these documents
  by the server-side provisioning/auth flows.

This follows Firebase best practice: claims for fast rule evaluation, documents
as source of truth.

## 6. Platform administrators vs. school administrators

| | Platform administrator | School administrator |
|---|---|---|
| **Scope** | Entire platform (all schools) | One school |
| **Flag** | `platformAdmin: true` (claim + profile) | `role: 'admin'` for that school |
| **Academic access** | Can read any school's data (claims bypass) | Only their own school's data |
| **Can grant platformAdmin?** | Yes (server-side only) | **No** — client rules reject any client-initiated `platformAdmin` change |
| **Created by** | Server-side provisioning (Admin SDK) | School admin creates teachers/bursars in their school |

A platform administrator does **not** automatically receive school-admin
academic access; they must be explicitly granted a membership in a school if
they need to manage that school's academic data (least privilege).

## 7. School-level status

`schools/{schoolId}` document:
```js
{
  type: 'school',
  schoolId: 'sch_A',
  schoolName: '...',
  status: 'active' | 'suspended' | 'closed',
  plan: 'trial' | 'starter' | 'school',
  ...
}
```
- `suspended` / `closed` schools are denied access to academic data.
- `active` is the normal operating state.

## 8. Why this is the simplest secure design

- **One `schoolId` field per academic document** (top-level collections,
  Option A from the assessment) — minimal data-model change.
- **Claims carry the active school + memberships + roles** — rules enforce
  `resource.data.schoolId == request.auth.token.schoolId` without extra reads.
- **No subcollections, no backend rearchitecture** in this milestone — keeps
  existing collection names, document IDs, and service signatures intact.
- **Explicit multi-school support** — `schoolIds` and per-school roles rather
  than assuming one school per user.
