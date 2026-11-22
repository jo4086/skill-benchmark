#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJsonAtomic } from '../bootstrap/common.mjs';
import { evaluateTaskRun } from './task.mjs';
import { evaluateStatic } from './static.mjs';
import { codeRubricSha256, evaluateAiCodeQuality, judgeConfig } from './ai-quality.mjs';
import { gradeFullQuality } from './full-quality.mjs';
import { copyEvaluationSnapshot, hashEvaluationSnapshot } from './snapshot.mjs';
import { countriesSourceSha256, restoreCountriesReference } from './countries.mjs';
import { readResultRuns } from '../runner/result.mjs';
import { taskResultsDirectory } from '../runner/storage.mjs';

const help = 'Usage: pnpm run evaluate -- (--result PATH/result.json | --runs PATH/run.json [more files]) [--judge-home /absolute/path | --skip-ai]';

function sumKnown(values) {
  return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : null;
}

export async function reevaluateRuns(runs, { judgeHome, skipAi = false, assess = evaluateTaskRun,
  staticCheck = evaluateStatic, aiCheck = evaluateAiCodeQuality,
  outputRoot, outputDirectory } = {}) {
  if (!runs.length) throw new Error('At least one saved run is required');
  if (runs.some((run) => run.taskId !== runs[0].taskId || run.inputHash !== runs[0].inputHash)) {
    throw new Error('Batched runs must have the same task and input hash');
  }
  const id = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`;
  const outputDir = outputDirectory ?? path.join(outputRoot ?? path.join(taskResultsDirectory(runs[0].taskId), 'quality'), id);
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const entries = [];
  for (const run of runs) {
    if (run.schemaVersion !== 1 || !run.id || !['FE-01', 'FE-03'].includes(run.taskId)
      || run.taskSource?.sha256 !== countriesSourceSha256) throw new Error('Unsupported saved run');
    const source = run.artifact?.directory ?? run.workDir;
    if (!source || !path.isAbsolute(source)) throw new Error(`Saved source unavailable: ${run.id}`);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-regrade-'));
    try {
      const evaluationDir = path.join(root, 'checks');
      const judgeDir = path.join(root, 'judge');
      const sourceSha256 = await copyEvaluationSnapshot(source, evaluationDir);
      if (run.artifact?.sha256 && run.artifact.sha256 !== sourceSha256) throw new Error(`Artifact hash mismatch: ${run.id}`);
      await copyEvaluationSnapshot(source, judgeDir);
      if (assess === evaluateTaskRun && !skipAi) await restoreCountriesReference(judgeDir);
      const judgeSourceSha256 = await hashEvaluationSnapshot(judgeDir);
      const assessment = await assess({ ...run, workDir: evaluationDir });
      const staticResult = await staticCheck(evaluationDir, root);
      let aiResult = { status: 'not_evaluated', score: null, reason: 'AI evaluation skipped', tokenUsage: null };
      if (!skipAi) {
        const isolatedJudgeHome = path.join(root, 'judge-home');
        await fs.mkdir(isolatedJudgeHome, { mode: 0o700 });
        if (judgeHome && await fs.stat(path.join(judgeHome, 'auth.json')).then(() => true, () => false)) {
          await fs.copyFile(path.join(judgeHome, 'auth.json'), path.join(isolatedJudgeHome, 'auth.json'));
          await fs.chmod(path.join(isolatedJudgeHome, 'auth.json'), 0o600);
        }
        try { aiResult = await aiCheck(judgeDir, { judgeHome: isolatedJudgeHome }); }
        catch (error) { aiResult = { status: 'error', score: null, reason: error.message, tokenUsage: null }; }
      }
      if (judgeSourceSha256 !== await hashEvaluationSnapshot(judgeDir)) throw new Error(`Judge source changed: ${run.id}`);
      const quality = gradeFullQuality(run.taskId, assessment, staticResult, aiResult);
      entries.push({ runId: run.id, taskId: run.taskId, environmentId: run.environmentId,
        attemptNumber: run.attemptNumber, sourceSha256, implementationUsage: run.usage,
        evaluatorUsage: aiResult.tokenUsage, objective: assessment, static: staticResult,
        aiCode: aiResult, quality });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }
  const record = { schemaVersion: 1, id, createdAt: new Date().toISOString(),
    evaluator: { judge: judgeConfig, codeRubricSha256, code: 1 }, runIds: runs.map((run) => run.id), entries,
    totals: {
      implementation: {
        inputTokens: sumKnown(entries.map((entry) => entry.implementationUsage?.inputTokens)),
        outputTokens: sumKnown(entries.map((entry) => entry.implementationUsage?.outputTokens)),
        cachedInputTokens: sumKnown(entries.map((entry) => entry.implementationUsage?.cachedInputTokens)),
      },
      evaluator: {
        promptTokens: sumKnown(entries.map((entry) => entry.evaluatorUsage?.prompt)),
        completionTokens: sumKnown(entries.map((entry) => entry.evaluatorUsage?.completion)),
        totalTokens: sumKnown(entries.map((entry) => entry.evaluatorUsage?.total)),
      },
    } };
  await writeJsonAtomic(path.join(outputDir, 'evaluation.json'), record);
  return { record, outputDir };
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.includes('--help')) { console.log(help); return; }
  const mode = args[0];
  if (!['--runs', '--result'].includes(mode)) throw new Error(help);
  const paths = [];
  let skipAi = false;
  let judgeHome;
  for (let i = 1; i < args.length; i += 1) {
    if (args[i] === '--skip-ai') skipAi = true;
    else if (args[i] === '--judge-home') {
      const directory = args[++i];
      if (!directory || directory.startsWith('--')) throw new Error(help);
      judgeHome = path.resolve(directory);
    }
    else if (args[i].startsWith('--')) throw new Error(`Unknown option: ${args[i]}`);
    else paths.push(args[i]);
  }
  if (!paths.length || (mode === '--result' && paths.length !== 1) || (judgeHome && skipAi)) throw new Error(help);
  const group = mode === '--result' ? await readResultRuns(paths[0]) : null;
  const runs = group?.runs ?? await Promise.all(paths.map((file) => readJson(path.resolve(file))));
  const outputRoot = group ? path.join(group.directory, 'quality', 'rechecks') : undefined;
  const { record, outputDir } = await reevaluateRuns(runs, { judgeHome, skipAi, outputRoot });
  console.log(`Evaluated ${record.entries.length} saved run(s): ${outputDir}`);
  for (const entry of record.entries) console.log(`${entry.environmentId} ${entry.runId}: score ${entry.quality.score ?? 'incomplete'}; pass ${entry.quality.passed}`);
  if (record.entries.some((entry) => entry.aiCode.status === 'error')) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Evaluation failed: ${error.message}`); process.exitCode = 1; });
}
