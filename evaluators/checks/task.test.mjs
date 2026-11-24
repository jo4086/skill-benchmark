import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countriesSourceSha256 } from './countries.mjs';
import { evaluateTaskRun } from './task.mjs';

test('legacy task ID is accepted only for the REST Countries source', async () => {
  assert.equal(await evaluateTaskRun({ taskId: 'FE-01', taskSource: { sha256: 'old-browser-extensions' } }), null);
  assert.equal(await evaluateTaskRun({ taskId: 'FE-03', taskSource: { sha256: 'other-source' } }), null);
  const result = await evaluateTaskRun({ taskId: 'FE-03', taskSource: { sha256: countriesSourceSha256 } });
  assert.equal(result.checks.length, 11);
  assert.ok(result.checks.every((item) => item.status === 'error'));
});
