import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { reevaluateRuns } from './evaluate.mjs';
import { countriesSourceSha256 } from './checks/countries.mjs';

test('saved artifact re-evaluation separates implementation and judge usage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-regrade-test-'));
  const artifact = path.join(root, 'artifact');
  await fs.mkdir(artifact);
  await fs.writeFile(path.join(artifact, 'App.tsx'), 'export const App = () => null;');
  const run = { schemaVersion: 1, id: 'run-1', taskId: 'FE-01', taskSource: { sha256: countriesSourceSha256 }, environmentId: 'baseline',
    repetition: 1, attemptNumber: 1, durationMs: 176543, inputHash: 'same-input',
    usage: { inputTokens: 50000, cachedInputTokens: 40000, outputTokens: 1000 },
    artifact: { directory: artifact } };
  try {
    await assert.rejects(reevaluateRuns([run, { ...run, id: 'run-2', inputHash: 'other-input' }], {
      outputRoot: path.join(root, 'results'),
    }), /same task and input hash/);
    const second = { ...run, id: 'run-2', environmentId: 'codex-workspace', durationMs: 239039,
      usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null } };
    const { record, reportFile } = await reevaluateRuns([run, second], {
      outputRoot: path.join(root, 'results'),
      assess: async (entry) => ({ checks: ['FE01-F01', 'FE01-F02', 'FE01-F03', 'FE01-F04', 'FE01-F05',
        'FE01-F06', 'FE01-F07', 'FE01-F08', 'FE01-A01', 'FE01-T01', 'FE01-T02']
        .map((id) => id === 'FE01-F03' && entry.environmentId === 'codex-workspace'
          ? { id, status: 'fail', evidence: { reason: 'locator.click: Timeout 5000ms exceeded.\n  - waiting for region menu' } }
          : { id, status: 'pass' }) }),
      staticCheck: async () => ({ score: 100, typescript: { pass: true }, eslint: { pass: true } }),
      aiCheck: async () => ({ status: 'evaluated', score: 80, tokenUsage: { total: 500 },
        dimensions: { structure: { points: 20, maximum: 25, file: 'App.tsx', line: 1,
          evidence: 'Views are distinct, but routing and state share one module.' } } }),
    });
    const entry = record.entries[0];
    assert.equal(entry.quality.score, 95);
    assert.equal(entry.quality.passed, true);
    assert.equal(entry.implementationUsage.inputTokens, 50000);
    assert.equal(entry.evaluatorUsage.total, 500);
    assert.equal(record.totals.implementation.inputTokens, null);
    assert.equal(record.totals.evaluator.totalTokens, 1000);
    const report = await fs.readFile(reportFile, 'utf8');
    assert.match(report, /지역 필터 \| ☑ 통과 \| ☐ 실패/);
    assert.match(report, /FE01-F03.*대기 시간 내 대상을 확인하지 못함 \(region menu\)/);
    assert.match(report, /긍정적인 점.*Views are distinct/);
    assert.match(report, /문제점.*routing and state share one module/);
    assert.match(report, /App\.tsx:1/);
    assert.match(report, /baseline \| 95\/100 \| 충족 \| 합격/);
    assert.match(report, /codex-workspace \| 90\/100 \| 미충족 \| 미달/);
    assert.match(report, /baseline \| 2분 57초 \| 10,000 \| 40,000 \| 1,000 \| 51,000/);
    assert.match(report, /codex-workspace \| 3분 59초 \| — \| — \| — \| —/);
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
    const { reportFile } = await reevaluateRuns([run, { ...run, id: 'run-2', environmentId: 'codex-workspace' }], {
      outputRoot: path.join(root, 'results'), judgeHome,
      assess: async () => ({ checks: [] }), staticCheck: async () => ({ score: null }),
      aiCheck: async (_workDir, { judgeHome: home }) => {
        homes.push(home);
        assert.equal(await fs.readFile(path.join(home, 'auth.json'), 'utf8'), 'test-only-placeholder');
        assert.deepEqual((await fs.readdir(home)).sort(), ['auth.json']);
        return { status: 'not_evaluated', score: null, tokenUsage: null };
      },
    });
    const report = await fs.readFile(reportFile, 'utf8');
    assert.match(report, /AI 채점.*미평가/);
    assert.match(report, /baseline \| 미산정 \| 미충족 \| 평가 미완료/);
    assert.equal(homes.length, 2);
    assert.notEqual(homes[0], homes[1]);
    await Promise.all(homes.map(async (home) => assert.rejects(fs.stat(home), { code: 'ENOENT' })));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
