import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { aggregateRuns, compareRuns, summarizeRun, validateRuns } from './compare.mjs';

function run(id, environmentId) {
  return {
    schemaVersion: 1, id, taskId: 'FE-01', environmentId, repetition: 1,
    inputHash: 'same-input', taskManifestHash: 'same-manifest', model: 'same-model',
    reasoningEffort: 'medium', codexVersion: 'same-version', options: { sandbox: 'workspace-write' },
    sequence: environmentId === 'baseline' ? 1 : 2, status: 'completed', exitCode: 0,
    timedOut: false, durationMs: 1000, usage: { inputTokens: 10, outputTokens: 5, reason: null },
  };
}

test('rejects comparisons with different inputs or duplicate slots', () => {
  const first = run('a', 'baseline');
  const second = run('b', 'codex-workspace');
  assert.doesNotThrow(() => validateRuns([first, second]));
  assert.throws(() => validateRuns([first, { ...second, inputHash: 'different' }]), /inputHash/);
  assert.throws(() => validateRuns([first, { ...second, environmentId: 'baseline' }]), /Duplicate environment/);
});

test('aggregates repetitions without replacing missing token measurements with zero', () => {
  const first = summarizeRun(run('a', 'baseline'));
  const second = summarizeRun({ ...run('b', 'baseline'), repetition: 2, durationMs: 2000,
    usage: { inputTokens: null, outputTokens: null, reason: 'missing_usage_events' } });
  const group = aggregateRuns([first, second]).baseline;
  assert.deepEqual(group.repetitions, [1, 2]);
  assert.deepEqual(group.durationMs, { count: 2, missing: 0, min: 1000, max: 2000, mean: 1500 });
  assert.deepEqual(group.inputTokens, { count: 1, missing: 1, min: 10, max: 10, mean: 10 });
  assert.deepEqual(group.cachedInputTokens, { count: 0, missing: 2, min: null, max: null, mean: null });
  assert.deepEqual(group.uncachedInputTokens, { count: 0, missing: 2, min: null, max: null, mean: null });
});

test('separates cached input from uncached input without double counting it', () => {
  const record = run('a', 'baseline');
  record.usage = { inputTokens: 100, cachedInputTokens: 80, outputTokens: 5, reason: null };
  const summary = summarizeRun(record);
  assert.equal(summary.usage.inputTokens, 100);
  assert.equal(summary.usage.cachedInputTokens, 80);
  assert.equal(summary.usage.uncachedInputTokens, 20);
  assert.equal(aggregateRuns([summary]).baseline.uncachedInputTokens.mean, 20);
  assert.equal(summarizeRun({ ...record, usage: { ...record.usage, cachedInputTokens: null } }).usage.uncachedInputTokens, null);
});

test('includes comparable objective checks in Promptfoo without treating visual checks as passed', async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-criteria-'));
  try {
    let suite;
    const assess = async (record) => ({ version: 1, checks: [
      { id: 'FE01-T01', status: record.environmentId === 'baseline' ? 'pass' : 'fail', evidence: {} },
      { id: 'FE01-V01', status: 'not_evaluated', evidence: {} },
    ] });
    const evaluate = async (value) => {
      suite = value;
      return { toEvaluateSummary: async () => ({ stats: { successes: 3, failures: 1, errors: 0 } }) };
    };
    const { comparison } = await compareRuns([run('a', 'baseline'), run('b', 'codex-workspace')], { assess, evaluate, outputRoot });
    assert.deepEqual(suite.tests.map((item) => item.description), ['Codex process completed successfully', 'FE01-T01 objective check']);
    assert.equal(comparison.runs[0].quality.checks.find((item) => item.id === 'FE01-V01').status, 'not_evaluated');
    assert.equal(comparison.quality.subjective.status, 'not_evaluated');
  } finally { await fs.rm(outputRoot, { recursive: true, force: true }); }
});

test('sends saved runs to Promptfoo without assigning a quality score', async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-compare-'));
  try {
    const first = run('a', 'baseline');
    const second = { ...run('b', 'codex-workspace'), status: 'failed', exitCode: 1,
      usage: { inputTokens: null, outputTokens: null, reason: 'missing_usage_events' } };
    let captured;
    const evaluate = async (suite, options) => {
      captured = { suite, options };
      return { toEvaluateSummary: async () => ({ stats: { successes: 1, failures: 1, errors: 0 } }) };
    };
    const { comparison, outputDir } = await compareRuns([first, second], { evaluate, assess: async () => null, outputRoot });
    assert.equal(captured.suite.providers.length, 2);
    assert.equal(captured.suite.tests[0].assert[0].value(JSON.stringify(second)).pass, false);
    assert.equal(comparison.quality.status, 'not_evaluated');
    assert.equal(comparison.runs[1].usage.inputTokens, null);
    assert.equal(comparison.execution.failures, 1);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(outputDir, 'comparison.json'))).runIds, ['a', 'b']);
    assert.equal(JSON.parse(await fs.readFile(path.join(outputDir, 'promptfoo.json'))).stats.failures, 1);
    const summary = await fs.readFile(path.join(outputDir, 'summary.md'), 'utf8');
    assert.match(summary, /비캐시 입력 \| 캐시 입력 \| 입력 전체 \| 출력 \| 총토큰/);
    assert.match(summary, /기능·시각·코드 품질 합격을 뜻하지 않는다/);
    assert.match(outputDir, /FE-01-baseline-vs-codex-workspace-/);
    assert.match(await fs.readFile(path.join(outputRoot, 'INDEX.md'), 'utf8'), /FE-01.*baseline vs codex-workspace.*summary\.md/);
  } finally {
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
});

test('Promptfoo evaluates saved synthetic runs and writes its result', async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-promptfoo-'));
  const previousCacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = path.join(outputRoot, 'cache');
  try {
    const second = { ...run('b', 'codex-workspace'), status: 'failed', exitCode: 1 };
    const { comparison, outputDir } = await compareRuns([run('a', 'baseline'), second], { assess: async () => null, outputRoot });
    const promptfoo = JSON.parse(await fs.readFile(path.join(outputDir, 'promptfoo.json'), 'utf8'));
    assert.equal(comparison.execution.successes, 1);
    assert.equal(comparison.execution.failures, 1);
    assert.equal(promptfoo.stats.successes, 1);
    assert.equal(promptfoo.stats.failures, 1);
  } finally {
    if (previousCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousCacheHome;
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
});
