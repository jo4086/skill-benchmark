import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gradeFullQuality } from './full-quality.mjs';

const checks = ['FE01-F01', 'FE01-F02', 'FE01-F03', 'FE01-F04', 'FE01-F05',
  'FE01-F06', 'FE01-F07', 'FE01-F08', 'FE01-A01', 'FE01-T01', 'FE01-T02']
  .map((id) => ({ id, status: 'pass' }));
const staticPass = { score: 100, typescript: { pass: true }, eslint: { pass: true } };

test('full quality uses fixed weights and mandatory gates', () => {
  const grade = gradeFullQuality('FE-01', { checks }, staticPass, { status: 'evaluated', score: 60 });
  assert.equal(grade.score, 90);
  assert.equal(grade.passed, true);
  assert.equal(grade.categories.functionality, 100);
  assert.equal(grade.categories.accessibility, 100);
  assert.equal(grade.categories.aiCode, 60);
  assert.equal(grade.visual.includedInScore, false);
  assert.equal(gradeFullQuality('FE-01', { checks }, { ...staticPass, eslint: { pass: false } }, { status: 'evaluated', score: 100 }).passed, false);
  assert.equal(gradeFullQuality('FE-01', { checks: checks.map((item) => item.id === 'FE01-F02' ? { ...item, status: 'fail' } : item) }, staticPass, { status: 'evaluated', score: 100 }).passed, false);
  assert.equal(gradeFullQuality('FE-01', { checks }, staticPass, { status: 'not_evaluated' }).score, null);
});
