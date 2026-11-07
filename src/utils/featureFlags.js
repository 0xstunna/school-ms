import { NAV_ITEMS } from './constants.js';

/**
 * FEATURE FLAGS — central source of truth for what's visible in the app.
 *
 * Scope (approved): students (incl. SchoolPay import), marks (exams, marks
 * entry, project work), report generation, user accounts, plus the
 * dependencies those need (subjects, classes, academic year / term settings,
 * NLSC grading). Everything else (finance: fees, payroll, expenses; staff;
 * attendance) is hidden.
 *
 * Set a flag to false to HIDE that module (route + nav item + dashboard
 * widgets). Code, services, pages and Firestore data are NOT deleted — hiding
 * is purely a UI/route layer. Disabled routes redirect to the dashboard.
 *
 * Each flag comments what turning it on reveals.
 */
export const FEATURES = {
  // ── In scope (kept visible) ──
  dashboard:        true,   // App landing page + redirect target for disabled routes
  students:         true,   // Students list + add/edit modal + SchoolPay import
  studentImport:    true,   // /students/import — SchoolPay-driven student import (admin)
  exams:            true,   // Exam setup + marks entry
  projectWork:      true,   // Project work (NLSC stand-alone records, shown on NLSC report cards)
  reportGeneration: true,   // Report cards + broadsheets (print layer — no nav item of its own)
  userAccounts:     true,   // Login + roles + user management
  login:            true,   // Auth login page
  legacyGrading:    true,   // Legacy UCE grading (kept for non-NLSC classes + reports)

  // ── Dependencies (required by the kept modules above) ──
  subjects:         true,   // Subjects (needed by exams / marks entry / reports)
  classes:          true,   // Classes + streams (CLASSES, STREAMS constants)
  academicYear:     true,   // Academic year setting (Settings page)
  termSettings:     true,   // Term settings (part of academic-year config)
  nlscGrading:      true,   // NLSC competence-based grading setup (Settings page)
  setup:            true,   // Setup wizard (creates first admin + app config)

  // ── Out of scope (hidden by default) ──
  attendance:       false,  // Attendance module
  fees:             false,  // Fees / fee payments (finance — hidden in production)
  payroll:          false,  // Payroll / salary (finance — hidden in production)
  expenses:         false,  // Expenses (finance — hidden in production)
  staff:            false,  // Staff management (hidden per scope decision)
};

export const isEnabled = (flag) => Boolean(FEATURES[flag]);

// True when at least one finance screen is enabled. Used to decide whether
// the bursar role has anything to show and whether 'bursar' appears in the
// user-management role picker.
export const financeEnabled =
  isEnabled('fees') || isEnabled('payroll') || isEnabled('expenses');

// ── Navigation filtering ───────────────────────────────────────────────────
// Returns the nav items that should be shown for a given role: an item is
// visible only when its feature flag is on AND the user has one of its roles.
// Dividers are kept only if the section they introduce still has at least one
// visible item (avoids empty "Finance" / "Administration" headers).

export const getVisibleNavItems = (userRole) => {
  const itemVisible = NAV_ITEMS.map((item) => {
    if (item.type === 'divider') return null;
    const featureOk = !item.feature || isEnabled(item.feature);
    const roleOk = !item.roles || item.roles.includes(userRole);
    return featureOk && roleOk;
  });

  const visible = [];
  let i = 0;
  while (i < NAV_ITEMS.length) {
    const item = NAV_ITEMS[i];
    if (item.type === 'divider') {
      // Look ahead to the next path-item in this section.
      let sectionHasVisible = false;
      let j = i + 1;
      while (j < NAV_ITEMS.length && NAV_ITEMS[j].type !== 'divider') {
        if (itemVisible[j]) { sectionHasVisible = true; break; }
        j++;
      }
      if (sectionHasVisible) visible.push(item);
      i++;
    } else {
      if (itemVisible[i]) visible.push(item);
      i++;
    }
  }
  return visible;
};
