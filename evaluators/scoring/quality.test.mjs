import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gradeCountriesAssessment } from './quality.mjs';

const ids = ['FE01-F01', 'FE01-F02', 'FE01-F03', 'FE01-F04', 'FE01-F05',
  'FE01-F06', 'FE01-F07', 'FE01-F08', 'FE01-A01', 'FE01-T01', 'FE01-T02'];

test('objective score and feedback retain each observed failure without claiming full quality', () => {
  const grade = gradeCountriesAssessment({ checks: ids.map((id) => ({ id, status: id === 'FE01-F02' ? 'fail' : 'pass' })) });
  assert.equal(grade.score, 90.91);
  assert.equal(grade.mandatoryPassed, false);
  assert.equal(grade.complete, false);
  assert.deepEqual(grade.feedback.map((item) => item.id), ['FE01-F02']);
});

test('missing checks leave the objective score unknown', () => {
  const grade = gradeCountriesAssessment({ checks: [{ id: 'FE01-F01', status: 'pass' }] });
  assert.equal(grade.score, null);
  assert.equal(grade.complete, false);
});

test('countries objective grade requires all eleven checks', () => {
  const grade = gradeCountriesAssessment({ checks: ids.map((id) => ({ id, status: id === 'FE01-F08' ? 'fail' : 'pass' })) });
  assert.equal(grade.scope, 'objective_diagnostic');
  assert.equal(grade.score, 90.91);
  assert.deepEqual(grade.feedback.map((item) => item.id), ['FE01-F08']);
  assert.equal(grade.complete, false);
});
