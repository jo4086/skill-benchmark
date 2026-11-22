import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { reevaluateRuns } from './evaluate.mjs';
import { countriesSourceSha256 } from './countries.mjs';

test('saved artifact re-evaluation separates implementation and judge usage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-regrade-test-'));
  const artifact = path.join(root, 'artifact');
  await fs.mkdir(artifact);
  await fs.writeFile(path.join(artifact, 'App.tsx'), 'export const App = () => null;');
  const run = { schemaVersion: 1, id: 'run-1', taskId: 'FE-01', taskSource: { sha256: countriesSourceSha256 }, environmentId: 'baseline',
    attemptNumber: 1, inputHash: 'same-input', usage: { inputTokens: 50000, outputTokens: 1000 },
    artifact: { directory: artifact } };
  try {
    await assert.rejects(reevaluateRuns([run, { ...run, id: 'run-2', inputHash: 'other-input' }], {
      outputRoot: path.join(root, 'results'),
    }), /same task and input hash/);
    const { record } = await reevaluateRuns([run], {
      outputRoot: path.join(root, 'results'),
      assess: async () => ({ checks: ['FE01-F01', 'FE01-F02', 'FE01-F03', 'FE01-F04', 'FE01-F05',
        'FE01-F06', 'FE01-F07', 'FE01-F08', 'FE01-A01', 'FE01-T01', 'FE01-T02']
        .map((id) => ({ id, status: 'pass' })) }),
      staticCheck: async () => ({ score: 100, typescript: { pass: true }, eslint: { pass: true } }),
      aiCheck: async () => ({ status: 'evaluated', score: 80, tokenUsage: { total: 500 } }),
    });
    const entry = record.entries[0];
    assert.equal(entry.quality.score, 95);
    assert.equal(entry.quality.passed, true);
    assert.equal(entry.implementationUsage.inputTokens, 50000);
    assert.equal(entry.evaluatorUsage.total, 500);
    assert.equal(record.totals.implementation.inputTokens, 50000);
    assert.equal(record.totals.evaluator.totalTokens, 500);
    assert.equal(await fs.readFile(path.join(artifact, 'App.tsx'), 'utf8'), 'export const App = () => null;');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('each AI assessment receives a fresh temporary home with only authentication', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-judge-home-test-'));
  const artifact = path.join(root, 'artifact');
  const judgeHome = path.join(root, 'auth-source');
  const homes = [];
  try {
    await fs.mkdir(artifact);
    await fs.mkdir(judgeHome);
    await fs.writeFile(path.join(artifact, 'App.tsx'), 'export const App = () => null;');
    await fs.writeFile(path.join(judgeHome, 'auth.json'), 'test-only-placeholder');
    const run = { schemaVersion: 1, id: 'run-1', taskId: 'FE-01',
      taskSource: { sha256: countriesSourceSha256 }, environmentId: 'baseline',
      inputHash: 'same-input', artifact: { directory: artifact } };
    await reevaluateRuns([run, { ...run, id: 'run-2', environmentId: 'codex-workspace' }], {
      outputRoot: path.join(root, 'results'), judgeHome,
      assess: async () => ({ checks: [] }), staticCheck: async () => ({ score: null }),
      aiCheck: async (_workDir, { judgeHome: home }) => {
        homes.push(home);
        assert.equal(await fs.readFile(path.join(home, 'auth.json'), 'utf8'), 'test-only-placeholder');
        assert.deepEqual((await fs.readdir(home)).sort(), ['auth.json']);
        return { status: 'not_evaluated', score: null, tokenUsage: null };
      },
    });
    assert.equal(homes.length, 2);
    assert.notEqual(homes[0], homes[1]);
    await Promise.all(homes.map(async (home) => assert.rejects(fs.stat(home), { code: 'ENOENT' })));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
