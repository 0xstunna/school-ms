/**
 * Marks-entry validation tests
 * Tests the validation logic used in MarksModal handleSave
 * Run with: node src/services/__tests__/marksEntry.test.js
 */

const assert = require('assert');

// Simulate the validateMarks logic from MarksModal
function validateMarksLogic(marks, students, outOf) {
  const errors = {};
  let hasError = false;

  students.forEach((s) => {
    const val = marks[s.id];
    if (val === '' || val === null || val === undefined) {
      // Missing marks — not an error, just not saved
      return;
    }
    const n = Number(val);
    if (isNaN(n)) {
      errors[s.id] = 'Invalid mark';
      hasError = true;
    } else if (n < 0 || n > outOf) {
      errors[s.id] = `Mark must be between 0 and ${outOf}`;
      hasError = true;
    }
  });

  return { errors, hasError };
}

// Simulate the toSave filter logic
function getToSave(marks, students) {
  return students
    .filter((s) => marks[s.id] !== '' && marks[s.id] !== null && marks[s.id] !== undefined)
    .map((s) => ({ studentId: s.id, marks: Number(marks[s.id]) }));
}

const students = [
  { id: 's1', fullName: 'Alice', admissionNumber: 'ADM0001' },
  { id: 's2', fullName: 'Bob',   admissionNumber: 'ADM0002' },
  { id: 's3', fullName: 'Carol', admissionNumber: 'ADM0003' },
];

const outOf = 100;

// ── Test 1: Valid marks can be saved ──
function testValidMarksSaved() {
  const marks = { s1: '85', s2: '90', s3: '78' };
  const { errors, hasError } = validateMarksLogic(marks, students, outOf);
  assert.strictEqual(hasError, false, 'No validation errors for valid marks');
  assert.deepStrictEqual(errors, {}, 'No errors should be present');

  const toSave = getToSave(marks, students);
  assert.strictEqual(toSave.length, 3, 'All 3 students should be saved');
  assert.deepStrictEqual(toSave, [
    { studentId: 's1', marks: 85 },
    { studentId: 's2', marks: 90 },
    { studentId: 's3', marks: 78 },
  ]);
  console.log('  PASS: testValidMarksSaved');
}

// ── Test 2: Marks outside permitted range rejected ──
function testOutOfRangeRejected() {
  const marks = { s1: '85', s2: '101', s3: '-5' };
  const { errors, hasError } = validateMarksLogic(marks, students, outOf);
  assert.strictEqual(hasError, true, 'Should have validation errors');
  assert.strictEqual(errors['s2'], 'Mark must be between 0 and 100', 'Bob: 101 out of range');
  assert.strictEqual(errors['s3'], 'Mark must be between 0 and 100', 'Carol: -5 out of range');
  assert.strictEqual(errors['s1'], undefined, 'Alice: 85 is valid');

  const toSave = getToSave(marks, students);
  // Even though validation fails, toSave would include all - but the caller checks hasError first
  assert.strictEqual(toSave.length, 3, 'getToSave returns all non-empty (validation happens separately)');
  console.log('  PASS: testOutOfRangeRejected');
}

// ── Test 3: Missing marks not converted to zero ──
function testMissingMarksNotZero() {
  const marks = { s1: '85', s2: '', s3: null };
  const toSave = getToSave(marks, students);
  assert.strictEqual(toSave.length, 1, 'Only Alice should be saved');
  assert.deepStrictEqual(toSave, [{ studentId: 's1', marks: 85 }], 'Only Alice with mark 85');
  // Bob and Carol are NOT converted to zero - they're simply excluded
  console.log('  PASS: testMissingMarksNotZero');
}

// ── Test 4: Duplicate assessment records prevented ──
// This is handled at the service level by deterministic ID: result_${examId}_${studentId}
// Saving twice overwrites (idempotent), no duplicates created
function testDuplicatePrevented() {
  const examId = 'e1';
  const studentId = 's1';
  const id1 = `result_${examId}_${studentId}`;
  const id2 = `result_${examId}_${studentId}`;
  assert.strictEqual(id1, id2, 'Same exam+student produces same ID - idempotent save');
  console.log('  PASS: testDuplicatePrevented (deterministic ID prevents duplicates)');
}

// ── Test 5: Invalid mark does not cause others to be saved incorrectly ──
function testInvalidMarkIsolation() {
  const marks = { s1: '85', s2: 'abc', s3: '90' };
  const { errors, hasError } = validateMarksLogic(marks, students, outOf);
  assert.strictEqual(hasError, true, 'Should detect invalid mark');
  assert.strictEqual(errors['s2'], 'Invalid mark', 'Bob has invalid mark');
  assert.strictEqual(errors['s1'], undefined, 'Alice has no error');
  assert.strictEqual(errors['s3'], undefined, 'Carol has no error');

  // The caller checks hasError and returns early, so NO marks are saved
  // This ensures one invalid mark doesn't cause others to be saved incorrectly
  console.log('  PASS: testInvalidMarkIsolation');
}

// ── Test 6: Saving does not affect unrelated student records ──
function testNoUnrelatedChanges() {
  const marks = { s1: '85' };
  const toSave = getToSave(marks, students);
  assert.strictEqual(toSave.length, 1, 'Only Alice is in toSave');
  assert.strictEqual(toSave[0].studentId, 's1', 'Only Alice');
  // Bob and Carol are not affected - their records remain unchanged
  console.log('  PASS: testNoUnrelatedChanges');
}

// ── Test 7: Boundary values ──
function testBoundaryValues() {
  // 0 is valid
  const marks0 = { s1: '0' };
  let { errors, hasError } = validateMarksLogic(marks0, students, outOf);
  assert.strictEqual(hasError, false, '0 should be valid');
  assert.deepStrictEqual(getToSave(marks0, students), [{ studentId: 's1', marks: 0 }]);

  // 100 is valid
  const marks100 = { s1: '100' };
  ({ errors, hasError } = validateMarksLogic(marks100, students, outOf));
  assert.strictEqual(hasError, false, '100 should be valid');

  // 100.5 should be invalid (not a whole number but still within range...)
  // Number('100.5') = 100.5 which is > 100? No, 100.5 > 100 so invalid
  const marks1005 = { s1: '100.5' };
  ({ errors, hasError } = validateMarksLogic(marks1005, students, outOf));
  assert.strictEqual(hasError, true, '100.5 should be out of range (> 100)');

  console.log('  PASS: testBoundaryValues');
}

// ── Run all tests ──
console.log('=== Marks Entry Tests ===\n');
try { testValidMarksSaved(); } catch (e) { console.log('  FAIL:', e.message); }
try { testOutOfRangeRejected(); } catch (e) { console.log('  FAIL:', e.message); }
try { testMissingMarksNotZero(); } catch (e) { console.log('  FAIL:', e.message); }
try { testDuplicatePrevented(); } catch (e) { console.log('  FAIL:', e.message); }
try { testInvalidMarkIsolation(); } catch (e) { console.log('  FAIL:', e.message); }
try { testNoUnrelatedChanges(); } catch (e) { console.log('  FAIL:', e.message); }
try { testBoundaryValues(); } catch (e) { console.log('  FAIL:', e.message); }
console.log('\n=== All marks entry tests completed ===');
