/**
 * PRINT UTILS
 * ===========
 *
 * Prints report cards and broadsheets by injecting a hidden <iframe>.
 * Handles BOTH grading modes:
 *   - LEGACY (UCE): aggregate, division, overall grade — output unchanged.
 *   - NLSC   (UNEB competence-based): per-subject CA/exam/final score +
 *     letter/descriptor, project-work line, certificate indicator,
 *     subjects-at-D-or-above count, NO aggregate/division column.
 *
 * NLSC vs LEGACY is detected from the card data itself:
 *   NLSC card => subjectRows carry `caMarks`/`finalScore`/`letter`/`descriptor`
 *   and the card carries `subjectsAtDOrAbove` / `certificateEligible`.
 */

const openPrintWindow = (htmlContent) => {
  const old = document.getElementById('__print_frame__');
  if (old) old.remove();

  const iframe = document.createElement('iframe');
  iframe.id = '__print_frame__';
  iframe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:none;pointer-events:none;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(htmlContent);
  doc.close();

  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 500);
  }, 350);
};

/* ─────────────────────────────────────────────
   SHARED STYLES
   ───────────────────────────────────────────── */
const baseStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1e293b; background: #fff; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    @page { margin: 12mm 10mm; }
  }
`;

const LETTER_COLOR = {
  A: '#15803d', B: '#0369a1', C: '#ca8a04', D: '#ea580c', E: '#b45309',
  F: '#dc2626', U: '#dc2626',
};

const gradeColor = (g) => LETTER_COLOR[g && g[0]] || '#475569';

const isNlscCard = (card) =>
  Boolean(card && card.subjectRows && card.subjectRows.some(
    (r) => r.caMarks !== null && r.caMarks !== undefined
  )) || Boolean(card && card.subjectsAtDOrAbove !== undefined);

/* ─────────────────────────────────────────────
   REPORT CARD
   ───────────────────────────────────────────── */
/**
 * @param {object} cardData   - one entry from reportCardService.getReportCardData().reportCards
 * @param {object} schoolInfo - { name, address, motto, logoUrl }
 * @param {object} termInfo   - { academicYear, term }
 */
export const printReportCard = (cardData, schoolInfo = {}, termInfo = {}) => {
  const {
    student, subjectRows, aggMarks, aggOutOf, avgPercentage, overallGrade,
    overallRemarks, position, totalInClass,
    // NLSC fields
    subjectsAtDOrAbove, totalSubjects, certificateEligible, subjectLetters,
    // project work injected by the caller when available
    projectWork,
  } = cardData;

  const schoolName    = schoolInfo.name    || 'School Name';
  const schoolAddress = schoolInfo.address || '';
  const schoolMotto   = schoolInfo.motto   || '';
  const logoHtml      = schoolInfo.logoUrl ? `<img src="${schoolInfo.logoUrl}" alt="logo" style="height:60px;object-fit:contain;" />` : '';

  if (isNlscCard(cardData)) {
    return printNlscReportCard({ student, subjectRows, subjectsAtDOrAbove, totalSubjects,
      certificateEligible, subjectLetters, projectWork, schoolInfo, termInfo, logoHtml, schoolName, schoolAddress, schoolMotto });
  }

  // ──────── LEGACY REPORT CARD (unchanged output) ────────
  const subjectRowsHtml = subjectRows.map((row) => {
    const examCols = row.examResults.map(
      (r) => `<td style="text-align:center;padding:5px 8px;">${r.marks}/${r.outOf}<br/><small style="color:#64748b;">${r.examType}</small></td>`
    ).join('');

    return `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:6px 8px;font-weight:500;">${row.subjectName}</td>
        ${examCols}
        <td style="text-align:center;padding:6px 8px;font-weight:600;">${row.totalMarks !== null ? `${row.totalMarks}/${row.totalOutOf}` : '—'}</td>
        <td style="text-align:center;padding:6px 8px;">${row.percentage !== null ? row.percentage + '%' : '—'}</td>
        <td style="text-align:center;padding:6px 8px;">
          <span style="font-weight:700;color:${gradeColor(row.grade)};font-size:14px;">${row.grade}</span>
        </td>
        <td style="padding:6px 8px;color:#64748b;font-size:11px;">${row.remarks}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8" /><title>Report Card — ${student.fullName}</title>
    <style>
      ${baseStyles}
      .page { max-width: 780px; margin: 0 auto; padding: 16px; }
      .header { display:flex; align-items:center; gap:16px; border-bottom:3px solid #1e3a5f; padding-bottom:12px; margin-bottom:16px; }
      .header-text { flex:1; }
      h1 { font-size:20px; font-weight:700; color:#1e3a5f; }
      .subtitle { font-size:11px; color:#64748b; margin-top:2px; }
      .badge-row { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
      .badge { background:#f1f5f9; border-radius:6px; padding:4px 10px; font-size:11px; }
      .badge strong { color:#1e3a5f; }
      table { width:100%; border-collapse:collapse; margin-bottom:14px; font-size:11.5px; }
      thead tr { background:#1e3a5f; color:#fff; }
      thead th { padding:7px 8px; text-align:left; font-weight:600; font-size:11px; }
      tbody tr:nth-child(even) { background:#f8fafc; }
      .summary-box { display:flex; gap:16px; flex-wrap:wrap; border:2px solid #1e3a5f; border-radius:8px; padding:12px 16px; margin-bottom:14px; }
      .summary-item { flex:1; min-width:100px; text-align:center; }
      .summary-item .val { font-size:22px; font-weight:700; color:#1e3a5f; }
      .summary-item .lbl { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:.5px; margin-top:2px; }
      .footer-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:24px; margin-top:20px; }
      .sig-line { border-top:1px solid #cbd5e1; padding-top:4px; font-size:10px; color:#64748b; margin-top:32px; }
      .print-btn { display:block; margin:16px auto; padding:8px 24px; background:#1e3a5f; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:13px; }
    </style>
  </head><body>
  <div class="page">
    <div class="header">
      ${logoHtml}
      <div class="header-text">
        <h1>${schoolName}</h1>
        ${schoolAddress ? `<div class="subtitle">${schoolAddress}</div>` : ''}
        ${schoolMotto   ? `<div class="subtitle" style="font-style:italic;">${schoolMotto}</div>` : ''}
      </div>
      <div style="text-align:right;">
        <div style="font-size:16px;font-weight:700;color:#1e3a5f;">STUDENT REPORT CARD</div>
        <div class="subtitle">${termInfo.term || ''} &nbsp;|&nbsp; ${termInfo.academicYear || ''}</div>
      </div>
    </div>

    <div class="badge-row">
      <div class="badge"><strong>Name:</strong> ${student.fullName}</div>
      <div class="badge"><strong>Adm No:</strong> ${student.admissionNumber || '—'}</div>
      <div class="badge"><strong>Class:</strong> ${student.classLevel || ''}${student.stream ? student.stream : ''}</div>
      ${student.gender ? `<div class="badge"><strong>Gender:</strong> ${student.gender}</div>` : ''}
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:180px;">Subject</th>
          <th colspan="10" style="text-align:center;">Exam Scores</th>
          <th style="text-align:center;">Total</th>
          <th style="text-align:center;">%</th>
          <th style="text-align:center;">Grade</th>
          <th>Remarks</th>
        </tr>
      </thead>
      <tbody>${subjectRowsHtml}</tbody>
    </table>

    <div class="summary-box">
      <div class="summary-item">
        <div class="val">${aggMarks !== null ? `${aggMarks}/${aggOutOf}` : '—'}</div>
        <div class="lbl">Total Marks</div>
      </div>
      <div class="summary-item">
        <div class="val">${avgPercentage !== null ? avgPercentage + '%' : '—'}</div>
        <div class="lbl">Average</div>
      </div>
      <div class="summary-item">
        <div class="val" style="color:${gradeColor(overallGrade)}">${overallGrade}</div>
        <div class="lbl">Overall Grade</div>
      </div>
      <div class="summary-item">
        <div class="val">${cardData.streamPosition !== null && cardData.streamPosition !== undefined ? `${cardData.streamPosition} / ${cardData.streamTotal || ''}` : (position !== null ? `${position} / ${totalInClass}` : '—')}</div>
        <div class="lbl">Stream Position</div>
      </div>
      <div class="summary-item">
        <div class="val">${cardData.overallClassPosition !== null && cardData.overallClassPosition !== undefined ? `${cardData.overallClassPosition} / ${cardData.overallClassTotal || totalInClass || ''}` : (position !== null ? `${position} / ${totalInClass}` : '—')}</div>
        <div class="lbl">Overall Class Position</div>
      </div>
      <div class="summary-item" style="flex:2;text-align:left;padding-left:8px;">
        <div style="font-size:13px;font-weight:600;color:#475569;">${overallRemarks}</div>
        <div class="lbl">Teacher's Remarks</div>
      </div>
    </div>

    <div class="footer-grid">
      <div><div class="sig-line">Class Teacher's Signature</div></div>
      <div><div class="sig-line">Head Teacher's Signature</div></div>
      <div><div class="sig-line">Parent / Guardian Signature</div></div>
    </div>

    <div style="margin-top:18px;font-size:10px;color:#94a3b8;text-align:center;">
      Generated on ${new Date().toLocaleDateString('en-UG', { year:'numeric', month:'long', day:'numeric' })}
      &nbsp;·&nbsp; ${schoolName}
    </div>
  </div>
  <button class="print-btn no-print" onclick="window.print()">🖨 Print Report Card</button>
  </body></html>`;

  openPrintWindow(html, `Report Card — ${student.fullName}`);
};

/* ─────────────────────────────────────────────
   NLSC REPORT CARD (competence-based)
   ───────────────────────────────────────────── */
function printNlscReportCard({ student, subjectRows, subjectsAtDOrAbove, totalSubjects,
  certificateEligible, subjectLetters, projectWork, schoolInfo, termInfo,
  logoHtml, schoolName, schoolAddress, schoolMotto }) {

  const rowsHtml = subjectRows.map((row) => {
    const ca = row.caMarks !== null && row.caOutOf
      ? `${row.caMarks}/${row.caOutOf} (${row.details && row.details.caPct !== null ? row.details.caPct : '—'}%)`
      : '—';
    const exam = row.examMarks !== null && row.examOutOf
      ? `${row.examMarks}/${row.examOutOf} (${row.details && row.details.examPct !== null ? row.details.examPct : '—'}%)`
      : '—';
    const final = row.finalScore !== null ? row.finalScore : '—';
    const letter = row.letter || '—';
    const warnHtml = row.warning
      ? `<td style="padding:6px 8px;color:#b45309;font-size:11px;font-weight:600;" title="${row.warning}">⚠ ${row.warning}</td>`
      : `<td style="padding:6px 8px;color:#64748b;font-size:11px;">—</td>`;

    return `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:6px 8px;font-weight:500;">${row.subjectName}</td>
        <td style="text-align:center;padding:6px 8px;">${ca}</td>
        <td style="text-align:center;padding:6px 8px;">${exam}</td>
        <td style="text-align:center;padding:6px 8px;font-weight:600;">${final}</td>
        <td style="text-align:center;padding:6px 8px;">
          <span style="font-weight:700;color:${gradeColor(letter)};font-size:14px;">${letter}</span>
        </td>
        <td style="padding:6px 8px;color:#64748b;font-size:11px;">${row.descriptor}</td>
        ${warnHtml}
      </tr>`;
  }).join('');

  const projectHtml = projectWork && projectWork.length
    ? projectWork.map((p) => `
      <tr style="border-bottom:1px solid #f1f5f9;background:#f8fafc;">
        <td style="padding:6px 8px;font-weight:500;">Project Work</td>
        <td style="text-align:center;padding:6px 8px;" colspan="3">${p.title || '—'}</td>
        <td style="text-align:center;padding:6px 8px;">
          <span style="font-weight:700;color:${gradeColor(p.achievementLevel)};font-size:14px;">${p.achievementLevel || '—'}</span>
        </td>
        <td style="padding:6px 8px;color:#64748b;font-size:11px;">${p.subjectOrArea || '—'}</td>
        <td style="padding:6px 8px;color:#64748b;font-size:11px;">${p.notes || '—'}</td>
      </tr>`).join('')
    : `<tr><td colspan="7" style="padding:8px;color:#64748b;font-size:11px;text-align:center;">No project work recorded.</td></tr>`;

  const dOrAbove = subjectsAtDOrAbove !== null ? subjectsAtDOrAbove : 0;
  const cert = certificateEligible ? 'YES' : 'NO';
  const certColor = certificateEligible ? '#15803d' : '#dc2626';

  const html = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8" /><title>Report Card — ${student.fullName}</title>
    <style>
      ${baseStyles}
      .page { max-width: 780px; margin: 0 auto; padding: 16px; }
      .header { display:flex; align-items:center; gap:16px; border-bottom:3px solid #1e3a5f; padding-bottom:12px; margin-bottom:16px; }
      .header-text { flex:1; }
      h1 { font-size:20px; font-weight:700; color:#1e3a5f; }
      .subtitle { font-size:11px; color:#64748b; margin-top:2px; }
      .badge-row { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
      .badge { background:#f1f5f9; border-radius:6px; padding:4px 10px; font-size:11px; }
      .badge strong { color:#1e3a5f; }
      table { width:100%; border-collapse:collapse; margin-bottom:14px; font-size:11.5px; }
      thead tr { background:#1e3a5f; color:#fff; }
      thead th { padding:7px 8px; text-align:left; font-weight:600; font-size:11px; }
      tbody tr:nth-child(even) { background:#f8fafc; }
      .summary-box { display:flex; gap:16px; flex-wrap:wrap; border:2px solid #1e3a5f; border-radius:8px; padding:12px 16px; margin-bottom:14px; }
      .summary-item { flex:1; min-width:100px; text-align:center; }
      .summary-item .val { font-size:22px; font-weight:700; color:#1e3a5f; }
      .summary-item .lbl { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:.5px; margin-top:2px; }
      .cert-box { display:flex; gap:16px; flex-wrap:wrap; border:2px solid #15803d; border-radius:8px; padding:12px 16px; margin-bottom:14px; }
      .cert-item { flex:1; min-width:100px; text-align:center; }
      .footer-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:24px; margin-top:20px; }
      .sig-line { border-top:1px solid #cbd5e1; padding-top:4px; font-size:10px; color:#64748b; margin-top:32px; }
      .print-btn { display:block; margin:16px auto; padding:8px 24px; background:#1e3a5f; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:13px; }
    </style>
  </head><body>
  <div class="page">
    <div class="header">
      ${logoHtml}
      <div class="header-text">
        <h1>${schoolName}</h1>
        ${schoolAddress ? `<div class="subtitle">${schoolAddress}</div>` : ''}
        ${schoolMotto   ? `<div class="subtitle" style="font-style:italic;">${schoolMotto}</div>` : ''}
      </div>
      <div style="text-align:right;">
        <div style="font-size:16px;font-weight:700;color:#1e3a5f;">STUDENT REPORT CARD — NLSC</div>
        <div class="subtitle">${termInfo.term || ''} &nbsp;|&nbsp; ${termInfo.academicYear || ''}</div>
      </div>
    </div>

    <div class="badge-row">
      <div class="badge"><strong>Name:</strong> ${student.fullName}</div>
      <div class="badge"><strong>Adm No:</strong> ${student.admissionNumber || '—'}</div>
      <div class="badge"><strong>Class:</strong> ${student.classLevel || ''}${student.stream ? student.stream : ''}</div>
      <div class="badge"><strong>Curriculum:</strong> New Lower Secondary</div>
      ${student.gender ? `<div class="badge"><strong>Gender:</strong> ${student.gender}</div>` : ''}
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:170px;">Subject</th>
          <th style="text-align:center;">CA</th>
          <th style="text-align:center;">Exam</th>
          <th style="text-align:center;">Final Score</th>
          <th style="text-align:center;">Letter</th>
          <th>Descriptor</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}${projectHtml}</tbody>
    </table>

    <div class="cert-box">
      <div class="cert-item">
        <div class="val">${totalSubjects !== null ? totalSubjects : '—'}</div>
        <div class="lbl">Subjects</div>
      </div>
      <div class="cert-item">
        <div class="val">${dOrAbove}</div>
        <div class="lbl">At D or Above</div>
      </div>
      <div class="cert-item">
        <div class="val" style="color:${certColor};">${cert}</div>
        <div class="lbl">Qualifies for Certificate</div>
      </div>
    </div>

    <div class="footer-grid">
      <div><div class="sig-line">Class Teacher's Signature</div></div>
      <div><div class="sig-line">Head Teacher's Signature</div></div>
      <div><div class="sig-line">Parent / Guardian Signature</div></div>
    </div>

    <div style="margin-top:18px;font-size:10px;color:#94a3b8;text-align:center;">
      Generated on ${new Date().toLocaleDateString('en-UG', { year:'numeric', month:'long', day:'numeric' })}
      &nbsp;·&nbsp; ${schoolName}
    </div>
  </div>
  <button class="print-btn no-print" onclick="window.print()">🖨 Print Report Card</button>
  </body></html>`;

  openPrintWindow(html, `Report Card — ${student.fullName}`);
}

/* ─────────────────────────────────────────────
   CLASS BROADSHEET
   ───────────────────────────────────────────── */
export const printBroadsheet = (broadsheetData, schoolInfo = {}, termInfo = {}) => {
  const { reportCards, subjects, classLevel, stream } = broadsheetData || {};
  const schoolName    = schoolInfo.name    || 'School Name';
  const schoolAddress = schoolInfo.address || '';
  const schoolMotto   = schoolInfo.motto   || '';
  const logoHtml      = schoolInfo.logoUrl ? '<img src="' + schoolInfo.logoUrl + '" alt="logo" style="height:60px;object-fit:contain;" />' : '';

  const firstCard = (reportCards && reportCards[0]) || {};
  const isNlsc = isNlscCard(firstCard);

  if (isNlsc) {
    return printNlscBroadsheet({ reportCards, subjects, classLevel, stream, schoolInfo, termInfo, logoHtml, schoolName, schoolAddress, schoolMotto });
  }

  // ──────── LEGACY BROADSHEET (unchanged output) ────────
  const streamLabel = stream && stream !== 'all' ? (stream.replace(classLevel, '') || '') : 'All Streams';

  const subjectHeaders = (subjects || []).map((subj) =>
    '<th style="text-align:center;padding:4px 6px;white-space:nowrap;">' + subj + '</th>'
  ).join('');

  const rowsHtml = (reportCards || []).map((card, idx) => {
    const subjectCells = (subjects || []).map((subj) => {
      const row = card.subjectRows ? card.subjectRows.find((r) => r.subjectName === subj) : null;
      if (row && row.totalMarks !== null && row.totalMarks !== undefined) {
        return '<td style="text-align:center;padding:4px 6px;">' + row.totalMarks + '<br/><small style="color:#64748b;">' + row.grade + '</small></td>';
      }
      return '<td style="text-align:center;padding:4px 6px;color:#cbd5e1;">—</td>';
    }).join('');

    const streamPos = (card.streamPosition !== null && card.streamPosition !== undefined) ? card.streamPosition : '—';
    const streamTotal = (card.streamTotal !== null && card.streamTotal !== undefined) ? card.streamTotal : '—';
    const overallPos = (card.overallClassPosition !== null && card.overallClassPosition !== undefined)
      ? card.overallClassPosition : (card.position !== null ? card.position : '—');
    const overallTotal = (card.overallClassTotal !== null && card.overallClassTotal !== undefined)
      ? card.overallClassTotal : (card.totalInClass !== null && card.totalInClass !== undefined ? card.totalInClass : '—');
    const studentStream = card.streamKey || ((card.student && card.student.stream)
      ? ((card.student.classLevel || classLevel) + card.student.stream)
      : '');

    return '<tr style="border-bottom:1px solid #f1f5f9;' + (idx % 2 === 1 ? 'background:#f8fafc;' : '') + '">'
      + '<td style="padding:4px 6px;text-align:center;">' + (idx + 1) + '</td>'
      + '<td style="padding:4px 6px;">' + (card.student ? card.student.fullName : '') + '</td>'
      + '<td style="padding:4px 6px;">' + (card.student && card.student.admissionNumber ? card.student.admissionNumber : '') + '</td>'
      + '<td style="padding:4px 6px;">' + studentStream + '</td>'
      + subjectCells
      + '<td style="text-align:center;padding:4px 6px;font-weight:600;">' + ((card.aggMarks !== null && card.aggMarks !== undefined) ? card.aggMarks : '—') + '</td>'
      + '<td style="text-align:center;padding:4px 6px;">' + ((card.avgPercentage !== null && card.avgPercentage !== undefined) ? card.avgPercentage + '%' : '—') + '</td>'
      + '<td style="text-align:center;padding:4px 6px;font-weight:700;color:' + gradeColor(card.overallGrade) + ';">' + (card.overallGrade || '—') + '</td>'
      + '<td style="text-align:center;padding:4px 6px;">' + streamPos + ' / ' + streamTotal + '</td>'
      + '<td style="text-align:center;padding:4px 6px;">' + overallPos + ' / ' + overallTotal + '</td>'
      + '</tr>';
  }).join('');

  const html = '<!DOCTYPE html><html><head>'
    + '<meta charset="UTF-8" /><title>Class Broadsheet — ' + classLevel + '</title>'
    + '<style>' + baseStyles
    + 'body { font-size: 10px; }'
    + '.page { max-width: 1400px; margin: 0 auto; padding: 12px; }'
    + '.header { display:flex; align-items:center; gap:12px; border-bottom:3px solid #1e3a5f; padding-bottom:8px; margin-bottom:12px; }'
    + '.header-text { flex:1; }'
    + 'h1 { font-size:18px; font-weight:700; color:#1e3a5f; }'
    + '.subtitle { font-size:10px; color:#64748b; margin-top:2px; }'
    + 'table { width:100%; border-collapse:collapse; font-size:9.5px; }'
    + 'thead tr { background:#1e3a5f; color:#fff; }'
    + 'thead th { padding:6px 4px; text-align:left; font-weight:600; font-size:9px; white-space:nowrap; }'
    + 'tbody tr:nth-child(even) { background:#f8fafc; }'
    + '@page { size: landscape; margin: 10mm; }'
    + '.print-btn { display:block; margin:16px auto; padding:8px 24px; background:#1e3a5f; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:13px; }'
    + '</style>'
    + '</head><body>'
    + '<div class="page">'
    + '<div class="header">'
    + logoHtml
    + '<div class="header-text">'
    + '<h1>' + schoolName + '</h1>'
    + (schoolAddress ? '<div class="subtitle">' + schoolAddress + '</div>' : '')
    + (schoolMotto ? '<div class="subtitle" style="font-style:italic;">' + schoolMotto + '</div>' : '')
    + '</div>'
    + '<div style="text-align:right;">'
    + '<div style="font-size:14px;font-weight:700;color:#1e3a5f;">CLASS BROADSHEET</div>'
    + '<div class="subtitle">' + classLevel + (streamLabel ? ' — ' + streamLabel : '') + ' &nbsp;|&nbsp; ' + (termInfo.term || '') + ' &nbsp;|&nbsp; ' + (termInfo.academicYear || '') + '</div>'
    + '</div>'
    + '</div>'
    + '<table>'
    + '<thead><tr>'
    + '<th style="text-align:center;padding:6px 4px;">#</th>'
    + '<th style="text-align:left;padding:6px 4px;">Student Name</th>'
    + '<th style="text-align:center;padding:6px 4px;">Adm No</th>'
    + '<th style="text-align:left;padding:6px 4px;">Stream</th>'
    + subjectHeaders
    + '<th style="text-align:center;padding:6px 4px;">Total</th>'
    + '<th style="text-align:center;padding:6px 4px;">Avg %</th>'
    + '<th style="text-align:center;padding:6px 4px;">Grade</th>'
    + '<th style="text-align:center;padding:6px 4px;">Stream Position</th>'
    + '<th style="text-align:center;padding:6px 4px;">Overall Class Position</th>'
    + '</tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody>'
    + '</table>'
    + '<div style="margin-top:12px;font-size:9px;color:#94a3b8;text-align:center;">Generated on ' + new Date().toLocaleDateString('en-UG', { year:'numeric', month:'long', day:'numeric' }) + ' &nbsp;·&nbsp; ' + schoolName + '</div>'
    + '</div>'
    + '<button class="print-btn no-print" onclick="window.print()">🖨 Print Broadsheet</button>'
    + '</body></html>';

  openPrintWindow(html);
};

/* ─────────────────────────────────────────────
   NLSC CLASS BROADSHEET (no aggregate/division)
   ───────────────────────────────────────────── */
function printNlscBroadsheet({ reportCards, subjects, classLevel, stream, schoolInfo, termInfo,
  logoHtml, schoolName, schoolAddress, schoolMotto }) {

  const streamLabel = stream && stream !== 'all' ? (stream.replace(classLevel, '') || '') : 'All Streams';

  const subjectHeaders = (subjects || []).map((subj) =>
    '<th style="text-align:center;padding:4px 6px;white-space:nowrap;">' + subj + '</th>'
  ).join('');

  const rowsHtml = (reportCards || []).map((card, idx) => {
    const subjectCells = (subjects || []).map((subj) => {
      const row = card.subjectRows ? card.subjectRows.find((r) => r.subjectName === subj) : null;
      if (row && row.finalScore !== null && row.finalScore !== undefined) {
        return '<td style="text-align:center;padding:4px 6px;">'
          + row.finalScore + '<br/><small style="color:#64748b;">' + (row.letter || '—') + '</small></td>';
      }
      return '<td style="text-align:center;padding:4px 6px;color:#cbd5e1;">—</td>';
    }).join('');

    const dOrAbove = card.subjectsAtDOrAbove !== null ? card.subjectsAtDOrAbove : 0;
    const cert = card.certificateEligible ? 'YES' : 'NO';
    const certColor = card.certificateEligible ? '#15803d' : '#dc2626';

    const streamPos = (card.streamPosition !== null && card.streamPosition !== undefined) ? card.streamPosition : '—';
    const streamTotal = (card.streamTotal !== null && card.streamTotal !== undefined) ? card.streamTotal : '—';
    const overallPos = (card.overallClassPosition !== null && card.overallClassPosition !== undefined)
      ? card.overallClassPosition : (card.position !== null ? card.position : '—');
    const overallTotal = (card.overallClassTotal !== null && card.overallClassTotal !== undefined)
      ? card.overallClassTotal : (card.totalInClass !== null && card.totalInClass !== undefined ? card.totalInClass : '—');
    const studentStream = card.streamKey || ((card.student && card.student.stream)
      ? ((card.student.classLevel || classLevel) + card.student.stream)
      : '');

    return '<tr style="border-bottom:1px solid #f1f5f9;' + (idx % 2 === 1 ? 'background:#f8fafc;' : '') + '">'
      + '<td style="padding:4px 6px;text-align:center;">' + (idx + 1) + '</td>'
      + '<td style="padding:4px 6px;">' + (card.student ? card.student.fullName : '') + '</td>'
      + '<td style="padding:4px 6px;">' + (card.student && card.student.admissionNumber ? card.student.admissionNumber : '') + '</td>'
      + '<td style="padding:4px 6px;">' + studentStream + '</td>'
      + subjectCells
      + '<td style="text-align:center;padding:4px 6px;font-weight:600;">' + dOrAbove + '</td>'
      + '<td style="text-align:center;padding:4px 6px;font-weight:700;color:' + certColor + ';">' + cert + '</td>'
      + '<td style="text-align:center;padding:4px 6px;">' + streamPos + ' / ' + streamTotal + '</td>'
      + '<td style="text-align:center;padding:4px 6px;">' + overallPos + ' / ' + overallTotal + '</td>'
      + '</tr>';
  }).join('');

  const html = '<!DOCTYPE html><html><head>'
    + '<meta charset="UTF-8" /><title>Class Broadsheet — ' + classLevel + '</title>'
    + '<style>' + baseStyles
    + 'body { font-size: 10px; }'
    + '.page { max-width: 1400px; margin: 0 auto; padding: 12px; }'
    + '.header { display:flex; align-items:center; gap:12px; border-bottom:3px solid #1e3a5f; padding-bottom:8px; margin-bottom:12px; }'
    + '.header-text { flex:1; }'
    + 'h1 { font-size:18px; font-weight:700; color:#1e3a5f; }'
    + '.subtitle { font-size:10px; color:#64748b; margin-top:2px; }'
    + 'table { width:100%; border-collapse:collapse; font-size:9.5px; }'
    + 'thead tr { background:#1e3a5f; color:#fff; }'
    + 'thead th { padding:6px 4px; text-align:left; font-weight:600; font-size:9px; white-space:nowrap; }'
    + 'tbody tr:nth-child(even) { background:#f8fafc; }'
    + '@page { size: landscape; margin: 10mm; }'
    + '.print-btn { display:block; margin:16px auto; padding:8px 24px; background:#1e3a5f; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:13px; }'
    + '</style>'
    + '</head><body>'
    + '<div class="page">'
    + '<div class="header">'
    + logoHtml
    + '<div class="header-text">'
    + '<h1>' + schoolName + '</h1>'
    + (schoolAddress ? '<div class="subtitle">' + schoolAddress + '</div>' : '')
    + (schoolMotto ? '<div class="subtitle" style="font-style:italic;">' + schoolMotto + '</div>' : '')
    + '</div>'
    + '<div style="text-align:right;">'
    + '<div style="font-size:14px;font-weight:700;color:#1e3a5f;">CLASS BROADSHEET — NLSC</div>'
    + '<div class="subtitle">' + classLevel + (streamLabel ? ' — ' + streamLabel : '') + ' &nbsp;|&nbsp; ' + (termInfo.term || '') + ' &nbsp;|&nbsp; ' + (termInfo.academicYear || '') + '</div>'
    + '</div>'
    + '</div>'
    + '<table>'
    + '<thead><tr>'
    + '<th style="text-align:center;padding:6px 4px;">#</th>'
    + '<th style="text-align:left;padding:6px 4px;">Student Name</th>'
    + '<th style="text-align:center;padding:6px 4px;">Adm No</th>'
    + '<th style="text-align:left;padding:6px 4px;">Stream</th>'
    + subjectHeaders
    + '<th style="text-align:center;padding:6px 4px;">Subjects at D+</th>'
    + '<th style="text-align:center;padding:6px 4px;">Certificate</th>'
    + '<th style="text-align:center;padding:6px 4px;">Stream Position</th>'
    + '<th style="text-align:center;padding:6px 4px;">Overall Class Position</th>'
    + '</tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody>'
    + '</table>'
    + '<div style="margin-top:12px;font-size:9px;color:#94a3b8;text-align:center;">Generated on ' + new Date().toLocaleDateString('en-UG', { year:'numeric', month:'long', day:'numeric' }) + ' &nbsp;·&nbsp; ' + schoolName + '</div>'
    + '</div>'
    + '<button class="print-btn no-print" onclick="window.print()">🖨 Print Broadsheet</button>'
    + '</body></html>';

  openPrintWindow(html);
};

/* ─────────────────────────────────────────────
   PAYROLL RECEIPT (unchanged)
   ───────────────────────────────────────────── */

/**
 * @param {object} entry      - payroll entry from recordPayroll / getPayrollEntries
 * @param {object} schoolInfo - { name, address, logoUrl }
 */
export const printPayrollReceipt = (entry, schoolInfo = {}) => {
  const schoolName    = schoolInfo.name    || 'School Name';
  const schoolAddress = schoolInfo.address || '';
  const logoHtml      = schoolInfo.logoUrl
    ? `<img src="${schoolInfo.logoUrl}" alt="logo" style="height:50px;object-fit:contain;" />`
    : '';

  const fmt = (n) => Number(n || 0).toLocaleString('en-UG', { minimumFractionDigits: 0 });
  const receiptNo = `PR-${entry.id?.replace('payroll-', '').toUpperCase() || Date.now()}`;

  const rows = [
    { label: 'Basic Salary',             value: entry.basicSalary, },
    { label: 'Allowances',               value: entry.allowances,  plus: true },
    { label: 'Deductions / Taxes',       value: entry.deductions,  minus: true },
  ].filter((r) => Number(r.value) !== 0);

  const rowsHtml = rows.map((r) => `
    <tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:7px 12px;">${r.label}</td>
      <td style="padding:7px 12px;text-align:right;color:${r.minus ? '#dc2626' : '#15803d'};">
        ${r.minus ? '− ' : r.plus ? '+ ' : ''}UGX ${fmt(r.value)}
      </td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8" /><title>Payroll Receipt — ${entry.staffName}</title>
    <style>
      ${baseStyles}
      .page { max-width: 520px; margin: 0 auto; padding: 20px; }
      .header { display:flex; align-items:center; gap:12px; border-bottom:3px solid #1e3a5f; padding-bottom:10px; margin-bottom:16px; }
      h1 { font-size:17px; font-weight:700; color:#1e3a5f; }
      .meta { display:grid; grid-template-columns:1fr 1fr; gap:6px 16px; background:#f8fafc; border-radius:8px; padding:10px 14px; margin-bottom:14px; font-size:11.5px; }
      .meta-label { color:#64748b; }
      .meta-value { font-weight:600; color:#1e293b; }
      table { width:100%; border-collapse:collapse; font-size:12px; margin-bottom:12px; }
      thead tr { background:#f1f5f9; }
      thead th { padding:7px 12px; text-align:left; color:#475569; font-size:11px; text-transform:uppercase; letter-spacing:.4px; }
      .net-row td { padding:10px 12px; font-size:15px; font-weight:700; background:#1e3a5f; color:#fff; border-radius:0 0 6px 6px; }
      .stamp { text-align:center; margin:14px 0; }
      .stamp .paid { display:inline-block; border:3px solid #15803d; color:#15803d; padding:4px 18px; border-radius:6px; font-size:18px; font-weight:800; letter-spacing:2px; transform:rotate(-4deg); }
      .sig-row { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:24px; }
      .sig-line { border-top:1px solid #cbd5e1; padding-top:4px; font-size:10px; color:#64748b; margin-top:28px; }
      .print-btn { display:block; margin:16px auto; padding:8px 24px; background:#1e3a5f; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:13px; }
    </style>
  </head><body>
  <div class="page">
    <div class="header">
      ${logoHtml}
      <div style="flex:1;">
        <h1>${schoolName}</h1>
        ${schoolAddress ? `<div style="font-size:10px;color:#64748b;">${schoolAddress}</div>` : ''}
      </div>
      <div style="text-align:right;">
        <div style="font-weight:700;color:#1e3a5f;font-size:14px;">SALARY RECEIPT</div>
        <div style="font-size:10px;color:#64748b;">${receiptNo}</div>
      </div>
    </div>

    <div class="meta">
      <span class="meta-label">Staff Name</span>     <span class="meta-value">${entry.staffName || '—'}</span>
      <span class="meta-label">Payment Date</span>   <span class="meta-value">${entry.paymentDate || '—'}</span>
      <span class="meta-label">Month</span>          <span class="meta-value">${entry.month || '—'}</span>
      <span class="meta-label">Academic Year</span>  <span class="meta-value">${entry.academicYear || '—'}</span>
      <span class="meta-label">Term</span>           <span class="meta-value">${entry.term || '—'}</span>
      <span class="meta-label">Payment Method</span> <span class="meta-value">${entry.paymentMethod || '—'}</span>
    </div>

    <table>
      <thead><tr><th>Description</th><th style="text-align:right;">Amount (UGX)</th></tr></thead>
      <tbody>
        ${rowsHtml}
      </tbody>
      <tfoot>
        <tr class="net-row">
          <td>NET SALARY</td>
          <td style="text-align:right;">UGX ${fmt(entry.netSalary)}</td>
        </tr>
      </tfoot>
    </table>

    <div class="stamp"><span class="paid">PAID</span></div>

    ${entry.notes ? `<p style="font-size:11px;color:#64748b;border-left:3px solid #cbd5e1;padding-left:8px;margin-bottom:14px;">Note: ${entry.notes}</p>` : ''}

    <div class="sig-row">
      <div><div class="sig-line">Prepared by</div></div>
      <div><div class="sig-line">Received by (Staff Signature)</div></div>
    </div>

    <div style="margin-top:18px;font-size:10px;color:#94a3b8;text-align:center;">
      Printed on ${new Date().toLocaleDateString('en-UG', { year:'numeric', month:'long', day:'numeric' })}
      &nbsp;·&nbsp; ${schoolName}
    </div>
  </div>
  <button class="print-btn no-print" onclick="window.print()">🖨 Print Receipt</button>
  </body></html>`;

  openPrintWindow(html, `Salary Receipt — ${entry.staffName}`);
};
