#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, readJson, writeJsonAtomic } from '../bootstrap/common.mjs';
import { countriesEvaluatorVersion } from './countries.mjs';
import { evaluateTaskRun } from './task.mjs';
import { copyEvaluationSnapshot } from './snapshot.mjs';
import { writeComparisonReports } from './report.mjs';
import { readResultRuns } from '../runner/result.mjs';
import { stateDirectory, taskResultsDirectory } from '../runner/storage.mjs';

const help = 'Usage: pnpm run compare -- --result PATH/result.json | --runs FIRST/run.json SECOND/run.json [more files]';

export function validateRuns(runs) {
  if (runs.length < 2) throw new Error('Comparison requires at least two runs');
  const first = runs[0];
  const fields = ['taskId', 'inputHash', 'taskManifestHash', 'model', 'reasoningEffort', 'codexVersion', 'options'];
  const ids = new Set();
  const slots = new Set();
  for (const run of runs) {
    if (run.schemaVersion !== 1 || !run.id || !run.environmentId || !Number.isSafeInteger(run.repetition) || run.repetition < 1) {
      throw new Error('Unsupported or incomplete run record');
    }
    if (ids.has(run.id)) throw new Error(`Duplicate run ID: ${run.id}`);
    ids.add(run.id);
    const slot = `${run.environmentId}:${run.repetition}`;
    if (slots.has(slot)) throw new Error(`Duplicate environment/repetition: ${slot}`);
    slots.add(slot);
    for (const field of fields) {
      if (JSON.stringify(run[field] ?? null) !== JSON.stringify(first[field] ?? null)) {
        throw new Error(`Runs differ in ${field}`);
      }
    }
  }
}

async function registeredSkills(run) {
  if (!run.environmentContentHash || !/^[a-z0-9-]+$/.test(run.environmentId)) return { status: 'unknown' };
  try {
    const manifest = await readJson(path.join(projectRoot, 'environments', run.environmentId, 'environment.json'));
    if (manifest.contentHash !== run.environmentContentHash || !Array.isArray(manifest.skillNames)) return { status: 'unknown' };
    return { status: 'known', names: [...new Set([...manifest.skillNames, ...(manifest.commonSkillNames ?? [])])].sort(), environmentContentHash: manifest.contentHash };
  } catch { return { status: 'unknown' }; }
}

export function summarizeRun(run, assessment = null, registration = { status: 'unknown' }) {
  const evaluated = assessment?.checks.some((item) => ['pass', 'fail'].includes(item.status));
  const usage = { ...run.usage,
    uncachedInputTokens: Number.isSafeInteger(run.usage?.inputTokens)
      && Number.isSafeInteger(run.usage?.cachedInputTokens)
      && run.usage.cachedInputTokens <= run.usage.inputTokens
      ? run.usage.inputTokens - run.usage.cachedInputTokens : null };
  return {
    runId: run.id, environmentId: run.environmentId, repetition: run.repetition,
    sequence: run.sequence, status: run.status, exitCode: run.exitCode,
    timedOut: run.timedOut, durationMs: run.durationMs,
    usage,
    quality: evaluated
      ? { status: 'partially_evaluated', evaluatorVersion: assessment.version, checks: assessment.checks }
      : { status: 'not_evaluated', reason: assessment ? 'no objective checks could run' : 'task-specific checks are not defined', checks: assessment?.checks ?? [] },
    skills: { registered: registration, actualUse: { status: 'unknown', reason: 'no verified Skill-use event mapping' } },
  };
}

function metric(values) {
  const present = values.filter((value) => Number.isFinite(value));
  return { count: present.length, missing: values.length - present.length,
    min: present.length ? Math.min(...present) : null, max: present.length ? Math.max(...present) : null,
    mean: present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null };
}

export function aggregateRuns(summaries) {
  const groups = Map.groupBy(summaries, (item) => item.environmentId);
  return Object.fromEntries([...groups].map(([environmentId, items]) => [environmentId, {
    repetitions: items.map((item) => item.repetition),
    durationMs: metric(items.map((item) => item.durationMs)),
    inputTokens: metric(items.map((item) => item.usage?.inputTokens)),
    cachedInputTokens: metric(items.map((item) => item.usage?.cachedInputTokens)),
    uncachedInputTokens: metric(items.map((item) => item.usage?.uncachedInputTokens)),
    outputTokens: metric(items.map((item) => item.usage?.outputTokens)),
    objectiveChecks: Object.fromEntries([...new Set(items.flatMap((item) => item.quality.checks.map((check) => check.id)))].map((id) => [id,
      Object.fromEntries(['pass', 'fail', 'error', 'not_evaluated'].map((status) => [status,
        items.filter((item) => item.quality.checks.some((check) => check.id === id && check.status === status)).length]))])),
  }]));
}

export async function compareRuns(runs, { evaluate, assess = evaluateTaskRun, outputRoot, outputDirectory } = {}) {
  validateRuns(runs);
  const label = [runs[0].taskId, [...new Set(runs.map((run) => run.environmentId))].join('-vs-')]
    .map((part) => part.replaceAll(/[^A-Za-z0-9-]/g, '-')).join('-');
  const id = `${label}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`;
  const resultsRoot = outputRoot ?? path.join(taskResultsDirectory(runs[0].taskId), 'comparisons');
  const outputDir = outputDirectory ?? path.join(resultsRoot, id);
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const summaries = [];
  for (const run of runs) {
    let assessment;
    if (assess === evaluateTaskRun && ['FE-01', 'FE-03'].includes(run.taskId)) {
      const source = run.artifact?.directory ?? run.workDir;
      if (!source || !path.isAbsolute(source)) throw new Error(`Saved source unavailable: ${run.id}`);
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-compare-'));
      try {
        const workDir = path.join(temporaryRoot, 'source');
        const hash = await copyEvaluationSnapshot(source, workDir);
        if (run.artifact?.sha256 && hash !== run.artifact.sha256) throw new Error(`Artifact hash mismatch: ${run.id}`);
        assessment = await assess({ ...run, workDir });
      } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
    } else assessment = await assess(run);
    summaries.push(summarizeRun(run, assessment, await registeredSkills(run)));
  }
  const providers = summaries.map((item) => ({
    id: () => `${item.environmentId}-repeat-${item.repetition}`,
    callApi: async () => ({ output: JSON.stringify(item) }),
  }));
  const comparableChecks = summaries[0].quality.checks?.filter((item) =>
    summaries.every((summary) => summary.quality.checks?.some((other) => other.id === item.id && ['pass', 'fail'].includes(other.status)))) ?? [];
  const suite = {
    description: `Saved Runner comparison: ${runs[0].taskId}`,
    prompts: ['Compare saved benchmark run'],
    providers,
    tests: [{
      description: 'Codex process completed successfully',
      assert: [{
        type: 'javascript', metric: 'execution_completed',
        value: (output) => {
          const item = JSON.parse(output);
          return {
            pass: item.status === 'completed' && item.exitCode === 0 && item.timedOut === false,
            score: item.status === 'completed' && item.exitCode === 0 && item.timedOut === false ? 1 : 0,
            reason: `Runner status: ${item.status}; exit code: ${item.exitCode}; timed out: ${item.timedOut}`,
          };
        },
      }],
    }, ...comparableChecks.map(({ id }) => ({
      description: `${id} objective check`,
      assert: [{
        type: 'javascript', metric: id,
        value: (output) => {
          const item = JSON.parse(output).quality.checks.find((entry) => entry.id === id);
          return { pass: item.status === 'pass', score: item.status === 'pass' ? 1 : 0,
            reason: `${id}: ${item.status}` };
        },
      }],
    }))],
  };
  if (!evaluate) {
    process.env.PROMPTFOO_CONFIG_DIR = path.join(outputRoot ?? stateDirectory(), '.promptfoo');
    process.env.PROMPTFOO_DISABLE_TELEMETRY = '1';
    process.env.PROMPTFOO_DISABLE_UPDATE = '1';
    await fs.mkdir(process.env.PROMPTFOO_CONFIG_DIR, { recursive: true });
    ({ evaluate } = await import('promptfoo'));
  }
  const promptfooPath = path.join(outputDir, 'promptfoo.json');
  const record = await evaluate(suite, {
    cache: false, sharing: false, writeLatestResults: false,
    maxConcurrency: 1,
  });
  const promptfoo = await record.toEvaluateSummary();
  await writeJsonAtomic(promptfooPath, promptfoo);
  const comparison = {
    schemaVersion: 1, id, evaluator: { name: 'promptfoo', version: '0.126.0', countriesVersion: countriesEvaluatorVersion },
    taskId: runs[0].taskId, inputHash: runs[0].inputHash,
    model: runs[0].model, reasoningEffort: runs[0].reasoningEffort,
    runIds: runs.map((run) => run.id), runs: summaries,
    byEnvironment: aggregateRuns(summaries),
    execution: { successes: runs.filter((run) => run.status === 'completed' && run.exitCode === 0 && !run.timedOut).length,
      failures: runs.filter((run) => run.status !== 'completed' || run.exitCode !== 0 || run.timedOut).length },
    quality: { status: comparableChecks.length ? 'partially_evaluated' : 'not_evaluated', comparableCheckIds: comparableChecks.map((item) => item.id), subjective: { status: 'not_evaluated' } },
    promptfooStats: promptfoo.stats,
    promptfooFile: 'promptfoo.json',
  };
  await writeJsonAtomic(path.join(outputDir, 'comparison.json'), comparison);
  const sources = new Map(runs.map((item) => [item.id, { record: item.recordFile, artifact: item.artifact?.directory }]));
  await writeComparisonReports(comparison, outputDir, outputDirectory ? null : resultsRoot, sources);
  return { comparison, outputDir };
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.includes('--help')) { console.log(help); return; }
  let runs;
  let outputRoot;
  if (args[0] === '--result' && args.length === 2) {
    const group = await readResultRuns(args[1]);
    runs = group.runs;
    outputRoot = path.join(group.directory, 'comparisons', 'rechecks');
  } else if (args[0] === '--runs' && args.length >= 3 && !args.slice(1).some((arg) => arg.startsWith('--'))) {
    runs = await Promise.all(args.slice(1).map(async (file) => {
      const recordFile = path.resolve(file);
      return { ...await readJson(recordFile), recordFile };
    }));
  } else {
    throw new Error(help);
  }
  const { comparison, outputDir } = await compareRuns(runs, { outputRoot });
  console.log(`Compared ${comparison.runs.length} runs: ${outputDir}`);
  for (const item of comparison.runs) {
    const tokens = item.usage?.inputTokens == null || item.usage?.outputTokens == null
      ? `unknown (${item.usage?.reason ?? 'missing'})`
      : `${item.usage.inputTokens + item.usage.outputTokens}`;
    console.log(`${item.environmentId} repeat ${item.repetition}: ${item.status}; ${item.durationMs ?? 'unknown'} ms; ${tokens} tokens; quality ${item.quality.status}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Comparison failed: ${error.message}`); process.exitCode = 1; });
}
