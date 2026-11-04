export const CLASSES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
export const STREAMS = ['A', 'B', 'C', 'D', 'E'];

export const CLASS_STREAMS = CLASSES.flatMap((c) =>
  STREAMS.map((s) => `${c}${s}`)
);

export const ROLES = {
  ADMIN:   'admin',
  TEACHER: 'teacher',
  BURSAR:  'bursar',
};

export const ROLE_LABELS = {
  admin:   'Administrator',
  teacher: 'Teacher',
  bursar:  'Bursar',
};

export const ROLE_COLORS = {
  admin:   'bg-navy-100 text-navy-800',
  teacher: 'bg-emerald-100 text-emerald-800',
  bursar:  'bg-amber-100 text-amber-800',
};

export const TERMS = ['Term 1', 'Term 2', 'Term 3'];

export const EXAM_TYPES = ['CAT', 'Midterm', 'Final'];

export const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Mobile Money', 'Cheque'];

export const EXPENSE_CATEGORIES = [
  'Utilities',
  'Supplies & Stationery',
  'Maintenance & Repairs',
  'Equipment',
  'Transport',
  'Cleaning & Sanitation',
  'Communication',
  'Other',
];

export const GENDERS = ['Male', 'Female'];

export const GUARDIAN_RELATIONSHIPS = [
  'Father', 'Mother', 'Guardian', 'Uncle', 'Aunt',
  'Grandfather', 'Grandmother', 'Sibling', 'Other',
];

export const STAFF_POSITIONS = [
  'Teacher', 'Principal', 'Deputy Principal', 'Bursar',
  'Administrator', 'Lab Technician', 'Librarian',
  'Nurse', 'Security', 'Cleaner', 'Cook', 'Driver', 'Other',
];

export const STUDENT_STATUSES = ['active', 'inactive', 'transferred', 'graduated', 'suspended'];

// Navigation items — role-based visibility
export const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    path: '/',
    icon: 'LayoutDashboard',
    roles: ['admin', 'teacher', 'bursar'],
  },
  { type: 'divider', label: 'Academic', roles: ['admin', 'teacher'] },
  {
    id: 'students',
    label: 'Students',
    path: '/students',
    icon: 'GraduationCap',
    roles: ['admin', 'teacher'],
  },
  {
    id: 'importStudents',
    label: 'Import Students',
    path: '/students/import',
    icon: 'Upload',
    roles: ['admin'],
  },
  {
    id: 'attendance',
    label: 'Attendance',
    path: '/attendance',
    icon: 'ClipboardList',
    roles: ['admin', 'teacher'],
  },
  {
    id: 'exams',
    label: 'Exams & Results',
    path: '/exams',
    icon: 'BookOpen',
    roles: ['admin', 'teacher'],
  },
  { type: 'divider', label: 'Finance', roles: ['admin', 'bursar'] },
  {
    id: 'fees',
    label: 'Fees',
    path: '/fees',
    icon: 'Wallet',
    roles: ['admin', 'bursar'],
  },
  {
    id: 'payroll',
    label: 'Payroll',
    path: '/payroll',
    icon: 'Banknote',
    roles: ['admin', 'bursar'],
  },
  {
    id: 'expenses',
    label: 'Expenses',
    path: '/expenses',
    icon: 'Receipt',
    roles: ['admin', 'bursar'],
  },
  { type: 'divider', label: 'Administration', roles: ['admin'] },
  {
    id: 'staff',
    label: 'Staff',
    path: '/staff',
    icon: 'Users',
    roles: ['admin'],
  },
  {
    id: 'subjects',
    label: 'Subjects',
    path: '/subjects',
    icon: 'BookMarked',
    roles: ['admin'],
  },
  {
    id: 'projectWork',
    label: 'Project Work',
    path: '/project-work',
    icon: 'ClipboardList',
    roles: ['admin', 'teacher'],
  },
  {
    id: 'users',
    label: 'User Accounts',
    path: '/users',
    icon: 'ShieldCheck',
    roles: ['admin'],
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: 'Settings',
    roles: ['admin'],
  },
];
