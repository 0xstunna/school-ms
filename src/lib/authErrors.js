// ─────────────────────────────────────────────────────────────────────────────
// Auth error messages — human-friendly replacements for Firebase Auth error codes
// ─────────────────────────────────────────────────────────────────────────────
//
// Firebase Auth returns opaque error codes (e.g. "auth/user-not-found").
// This module maps them to clear, school-staff-friendly messages so users are
// never shown internal codes like "auth/wrong-password".

export const AUTH_ERROR_MESSAGES = {
  'auth/user-not-found':
    'No account found with this email address. Please check your email or contact your administrator.',
  'auth/wrong-password':
    'Invalid password. Please try again or contact your administrator to reset it.',
  'auth/invalid-email':
    'Please enter a valid email address.',
  'auth/user-disabled':
    'This account has been deactivated. Contact your administrator to reactivate it.',
  'auth/too-many-requests':
    'Too many failed sign-in attempts. Please try again later.',
  'auth/network-request-failed':
    'Network error. Please check your internet connection and try again.',
  'auth/email-already-in-use':
    'An account with this email address already exists.',
  'auth/weak-password':
    'Password is too weak. Please choose a stronger password.',
  'auth/operation-not-allowed':
    'Email/password sign-in is not enabled for this project. Contact your administrator.',
  'auth/invalid-credential':
    'Invalid email or password. Please try again.',
};

/**
 * Converts a Firebase Auth error (or any Error) into a clear user-facing
 * message. Falls back to the error's own message when no known code matches,
 * and to a generic message when there is no message at all.
 *
 * @param {Error | null | undefined} err
 * @returns {string}
 */
export function authErrorMessage(err) {
  if (!err) return 'Sign-in failed. Please try again.';

  // Firebase Auth errors carry a `code` like "auth/user-not-found".
  const code = err.code || '';
  if (AUTH_ERROR_MESSAGES[code]) {
    return AUTH_ERROR_MESSAGES[code];
  }

  // Some Firebase errors surface the message in `message`; use it if it looks
  // human-readable (not an internal code / stack trace fragment).
  const msg = String(err.message || '').trim();
  if (msg && !msg.startsWith('auth/') && msg.length < 200) {
    return msg;
  }

  return 'Sign-in failed. Please try again.';
}
