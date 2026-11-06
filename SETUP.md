# ⚡ Quick Setup Guide

## 1. Install dependencies

```bash
npm install
```

## 2. Create your Firebase project

1. Go to **https://console.firebase.google.com**
2. Click **"Add project"** → give it a name (e.g. `my-school-sms`)
3. Disable Google Analytics (optional) → **Create project**

## 3. Add a Web App to Firebase

1. In your project dashboard, click the **Web icon `</>`**
2. Register app with a nickname (e.g. `alama-web`)
3. **Copy the `firebaseConfig` object** — you'll need it next

## 4. Enable Email/Password authentication

1. In the Firebase console sidebar: **Build → Authentication**
2. Click **Get started**
3. Go to the **Sign-in method** tab
4. Enable **Email/Password** → **Save**

> The app signs users in with email + password only. No other providers are
> required.

## 5. Enable Firestore Database (choose region carefully)

1. In the Firebase console sidebar: **Build → Firestore Database**
2. Click **"Create database"**
3. **Do NOT start in test mode.** Start in **locked mode** (deny all) or test
   mode, then immediately deploy the rules from this repo (step 7). Test mode
   is open to the internet and must not be left on.
4. **Select a region close to your school** — this cannot be changed later.
   For Ugandan schools, `europe-west1` (Belgium) or `us-central1` are common
   choices.
5. Click **Done**

## 6. Paste your Firebase config

Open `src/db/firebase.js` and replace the placeholder block:

```js
// BEFORE (placeholder):
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

// AFTER (your real values from Firebase console):
const firebaseConfig = {
  apiKey:            "AIzaSyABC123...",
  authDomain:        "my-school-sms.firebaseapp.com",
  projectId:         "my-school-sms",
  storageBucket:     "my-school-sms.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123",
};
```

## 7. Add your Vercel URL to authorised domains (hosted builds)

If you host the web build on Vercel, add the deployment URL so Firebase Auth
does not block sign-in from it:

1. Firebase console → **Build → Authentication** → **Settings** tab
2. Under **Authorised domains**, click **Add domain**
3. Enter your Vercel domain, e.g. `alama.vercel.app`
4. Click **Add**

> Local development (`localhost`) and Electron are allowed by default; only
> production hosted URLs need to be added here.

## 8. Run the app

```bash
npm run dev
```

The app will open in Electron. On first launch, the **Setup Wizard** appears.

---

## 🔒 Firestore Security Rules (production)

The rules live in this repo at **`firestore.rules`**. Deploy them **before**
going live — the app is locked down by default and will not work with open
rules.

### Option A — Firebase Console (paste)

1. Firebase console → **Build → Firestore Database** → **Rules** tab
2. Paste the entire contents of `firestore.rules`
3. Click **Publish**

### Option B — Firebase CLI

```bash
# Install the CLI (once)
npm install -g firebase-tools

# Login
firebase login

# Init (if not already done)
firebase init firestore

# Deploy only the rules
firebase deploy --only firestore:rules
```

### What the rules enforce

| Collection | Read | Create | Update | Delete |
|------------|------|--------|--------|--------|
| `config/app_config` (school name, logo, year, term) | staff + public (cold-boot check) | admin only | admin only (after setup) | never |
| `config/setup` (first-admin guard flag) | anyone | once only, while setup not done | never | never |
| `config/grading_settings` | staff | admin | admin | never |
| `users` (accounts) | staff | admin only (no self-escalation to admin) | admin; self (non-role fields) | admin |
| `students` | staff | admin / teacher | admin / teacher | admin |
| `exams` | staff | admin / teacher | admin / teacher | admin |
| `exam_results` | staff | admin / teacher | admin / teacher | admin |
| `projectWork` | staff | admin / teacher | admin / teacher | admin |
| `classes` | staff | admin | admin | admin |
| `staff` | staff | admin | admin | admin |
| `subjects` | staff | admin | admin | admin |
| `attendance` | staff | admin / teacher | admin / teacher | admin |
| `fee_structures` | staff | admin / bursar | admin / bursar | never |
| `fee_payments` | staff | admin / bursar | admin / bursar | admin |
| `payroll` | staff | admin / bursar | admin / bursar | never |
| `expenses` | staff | admin / bursar | admin / bursar | admin |
| Everything else | denied | denied | denied | denied |

`staff` = admin, teacher, or bursar with an active profile.

### First-admin setup (cannot be re-run once an admin exists)

`createFirstAdmin()` creates the Firebase Auth account and writes the Firestore
profile **plus the `config/setup` flag in one atomic batch**. Once `config/setup`
exists:

- `isSetupComplete()` returns `true`, so the Setup Wizard never shows again.
- The `config/setup` flag is immutable (cannot be updated or deleted).

If an earlier attempt created the Auth user but failed before writing the
profile, re-running setup reuses the existing account
(`auth/email-already-in-use` path) rather than duplicating it.

### "Is setup complete?" before anyone is signed in

`isSetupComplete()` reads a single document, `config/setup`, with **no
authentication required**. The rules allow a public read of `config/setup` and
`config/app_config` specifically for this cold-boot check. No sign-in is
needed, and no other data is readable unsigned.

### Admin-created teacher accounts do NOT sign the admin out

`createUser()` (admin creates teacher/bursar accounts) uses a temporary
secondary Firebase App instance, so the signed-in admin stays signed in while
the new account is created. No code change is needed here.

---

## 🌐 How offline mode works

This app uses **Firestore's persistent local cache** (IndexedDB).

| Scenario | Behaviour |
|----------|-----------|
| ✅ Online | Reads/writes go to Firebase, cached locally |
| 📴 Offline | Reads/writes use the local IndexedDB cache |
| 🔄 Reconnects | Local changes automatically sync to Firebase |

No special setup needed — it's automatic.
