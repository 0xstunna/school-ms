export const GRADE_SCALE = [
  { min: 80, grade: 'A', points: 1, remarks: 'Excellent', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  { min: 70, grade: 'B', points: 2, remarks: 'Good',      color: 'text-blue-700',    bg: 'bg-blue-100'    },
  { min: 60, grade: 'C', points: 3, remarks: 'Average',   color: 'text-amber-700',   bg: 'bg-amber-100'   },
  { min: 50, grade: 'D', points: 4, remarks: 'Pass',      color: 'text-orange-700',  bg: 'bg-orange-100'  },
  { min: 0,  grade: 'F', points: 9, remarks: 'Fail',      color: 'text-red-700',     bg: 'bg-red-100'     },
];

export const getGrade = (percentage) => {
  for (const scale of GRADE_SCALE) {
    if (percentage >= scale.min) return scale;
  }
  return GRADE_SCALE[GRADE_SCALE.length - 1];
};

export const getGradeFromMarks = (marks, outOf) => {
  if (!outOf || outOf === 0) return getGrade(0);
  const pct = Math.min(100, Math.round((marks / outOf) * 100));
  return { ...getGrade(pct), percentage: pct };
};

export const getDivision = (aggregatePoints) => {
  if (aggregatePoints <= 6)  return { division: 'Division I',   label: 'Div I'   };
  if (aggregatePoints <= 12) return { division: 'Division II',  label: 'Div II'  };
  if (aggregatePoints <= 18) return { division: 'Division III', label: 'Div III' };
  if (aggregatePoints <= 32) return { division: 'Division IV',  label: 'Div IV'  };
  return { division: 'Fail', label: 'F' };
};

export const formatCurrency = (amount, currency = 'UGX') =>
  `${currency} ${Number(amount || 0).toLocaleString()}`;

// Handles both ISO strings and Firestore Timestamp objects
export const formatDate = (dateVal) => {
  if (!dateVal) return '—';
  const date = typeof dateVal?.toDate === 'function'
    ? dateVal.toDate()
    : new Date(dateVal);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-UG', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const getCurrentDateISO = () => new Date().toISOString().split('T')[0];

export const generateAcademicYears = () => {
  // Academic years are single years from 2026 onward (not ranges like "2026/2027").
  // Always start at 2026 so earlier years stay selectable; run through currentYear + 3.
  const start = 2026;
  const end = new Date().getFullYear() + 3;
  const years = [];
  for (let y = start; y <= end; y++) years.push(String(y));
  return years;
};
