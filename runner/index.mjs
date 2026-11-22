#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoSymlinks, environmentPaths, exists, projectRoot, readJson, run, writeJsonAtomic } from '../bootstrap/common.mjs';
import { collectSessionId, collectUsage } from './usage.mjs';
import { prepareTask } from '../tasks/package.mjs';
import { compareRuns } from '../evaluators/compare.mjs';
import { evaluateTaskRun } from '../evaluators/task.mjs';
import { gradeTaskAssessment } from '../evaluators/quality.mjs';
import { copyEvaluationSnapshot } from '../evaluators/snapshot.mjs';
import { reevaluateRuns } from '../evaluators/evaluate.mjs';
import { runTrial } from './trial.mjs';
import { collectSelfValidation } from './self-validation.mjs';
import { assertSafeWorkPath, captureInstructions, createRunDirectories } from './storage.mjs';
import { createUserChecklist, environmentDirectory, saveResult, snapshotFinalAttempt } from './result.mjs';
import { chromium } from 'playwright';

const indexFile = path.join(projectRoot, 'environments', 'index.json');
const help = `Usage: pnpm run runner -- --task tasks/FE-01 --environments ID[,ID] [options]
       pnpm run runner -- --task-id ID --prompt-file FILE --fixture-dir DIR --environments ID[,ID] [options]

Options:
  --repeats N          Runs per environment (default: 1; maximum: 3)
  --model MODEL        Pass the same model to every run (default: gpt-6.2-sol)
  --reasoning LEVEL    Pass the same reasoning effort to every run
  --timeout-seconds N  Per-run timeout (default: 1800)
  --feedback-repairs N  Repair the same session after evaluation (0-2; default: 0)
  --diagnostic-target-score N  Objective diagnostic stop score (1-100; default: 50 with repairs)
  --evaluate-quality  Run static, Playwright and AI code quality evaluation after all attempts
  --judge-home DIR    Isolated evaluator Codex home (with --evaluate-quality)
  --dry-run            Validate inputs and print the execution plan only

Every live invocation is limited to three independent trials. Repair mode supports the FE-01 objective diagnostic only; full quality pass cannot be determined. Logs and working files may contain sensitive data.
`;

export function parseArgs(args) {
  const options = { repeats: 1, timeoutSeconds: 1800, feedbackRepairs: 0, diagnosticTargetScore: 50, dryRun: false, evaluateQuality: false, model: 'gpt-6.2-sol' };
  const values = new Map([
    ['--task-id', 'taskId'], ['--prompt-file', 'promptFile'], ['--fixture-dir', 'fixtureDir'],
    ['--task', 'taskDir'],
    ['--environments', 'environments'], ['--repeats', 'repeats'], ['--model', 'model'],
    ['--reasoning', 'reasoning'], ['--timeout-seconds', 'timeoutSeconds'],
    ['--feedback-repairs', 'feedbackRepairs'],
    ['--diagnostic-target-score', 'diagnosticTargetScore'],
    ['--judge-home', 'judgeHome'],
  ]);
  for (let index = args[0] === '--' ? 1 : 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help') { options.help = true; continue; }
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--evaluate-quality') { options.evaluateQuality = true; continue; }
    const key = values.get(arg);
    if (!key || !args[index + 1] || args[index + 1].startsWith('--') || options[key] !== undefined && !['repeats', 'timeoutSeconds', 'feedbackRepairs', 'diagnosticTargetScore', 'model'].includes(key)) {
      throw new Error(`Unknown, duplicate, or incomplete option: ${arg}`);
    }
    if (['repeats', 'timeoutSeconds', 'feedbackRepairs', 'diagnosticTargetScore', 'model'].includes(key) && options[`${key}Set`]) throw new Error(`Duplicate option: ${arg}`);
    options[key] = args[++index];
    if (['repeats', 'timeoutSeconds', 'feedbackRepairs', 'diagnosticTargetScore', 'model'].includes(key)) options[`${key}Set`] = true;
  }
  if (options.help) return options;
  if (!options.environments) throw new Error('Missing --environments');
  if (options.taskDir) {
    if (options.taskId || options.promptFile || options.fixtureDir) throw new Error('--task cannot be combined with direct input options');
  } else if (!options.taskId || !/^[a-z0-9][a-z0-9-]*$/.test(options.taskId) || !options.promptFile || !options.fixtureDir) {
    throw new Error('Required: --task or --task-id, --prompt-file, --fixture-dir');
  }
  options.environments = options.environments.split(',');
  if (options.environments.some((id) => !/^[a-z0-9][a-z0-9-]*$/.test(id)) || new Set(options.environments).size !== options.environments.length) {
    throw new Error('Environment IDs must be unique and nonempty');
  }
  for (const key of ['repeats', 'timeoutSeconds']) {
    const value = Number(options[key]);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`);
    options[key] = value;
  }
  if (options.timeoutSeconds > 86400) throw new Error('timeoutSeconds must be at most 86400');
  options.feedbackRepairs = Number(options.feedbackRepairs);
  if (!Number.isSafeInteger(options.feedbackRepairs) || options.feedbackRepairs < 0 || options.feedbackRepairs > 2) throw new Error('feedbackRepairs must be between 0 and 2');
  options.diagnosticTargetScore = Number(options.diagnosticTargetScore);
  if (!Number.isSafeInteger(options.diagnosticTargetScore) || options.diagnosticTargetScore < 1 || options.diagnosticTargetScore > 100) {
    throw new Error('diagnosticTargetScore must be between 1 and 100');
  }
  if (options.feedbackRepairs) {
    if (!options.taskDir || path.basename(path.resolve(options.taskDir)) !== 'FE-01') {
      throw new Error('Feedback repairs require --task tasks/FE-01');
    }
  } else if (options.diagnosticTargetScoreSet) {
    throw new Error('--diagnostic-target-score requires --feedback-repairs');
  }
  if (options.environments.length * options.repeats > 3) throw new Error('Maximum three runs per invocation');
  if (options.evaluateQuality && (!options.taskDir || path.basename(path.resolve(options.taskDir)) !== 'FE-01')) {
    throw new Error('Quality evaluation requires --task tasks/FE-01');
  }
  if (options.judgeHome && !options.evaluateQuality) throw new Error('--judge-home requires --evaluate-quality');
  if (options.judgeHome) options.judgeHome = path.resolve(options.judgeHome);
  if (options.model !== undefined && !/^[\w.:-]+$/.test(options.model)) throw new Error('Invalid --model');
  if (options.reasoning !== undefined && !['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(options.reasoning)) {
    throw new Error('Invalid --reasoning');
  }
  return options;
}

async function inspectInputs(options) {
  const promptFile = path.resolve(options.promptFile);
  const fixtureDir = path.resolve(options.fixtureDir);
  if (!(await fs.lstat(promptFile)).isFile()) throw new Error('Prompt must be a regular file');
  if (!(await fs.lstat(fixtureDir)).isDirectory()) throw new Error('Fixture must be a directory');
  await assertNoSymlinks(promptFile);
  await assertNoSymlinks(fixtureDir);
  const prompt = await fs.readFile(promptFile, 'utf8');
  if (!prompt.trim()) throw new Error('Prompt is empty');
  const hash = createHash('sha256').update(prompt);
  async function visit(directory, relative = '') {
    for (const name of (await fs.readdir(directory)).sort()) {
      const full = path.join(directory, name);
      const next = path.posix.join(relative, name);
      const stat = await fs.lstat(full);
      hash.update(`${stat.isDirectory() ? 'dir' : 'file'}:${next}\n`);
      if (stat.isDirectory()) await visit(full, next);
      else if (stat.isFile()) hash.update(await fs.readFile(full));
    }
  }
  await visit(fixtureDir);
  return { prompt, promptFile, fixtureDir, inputHash: hash.digest('hex') };
}

async function inspectEnvironments(ids, dryRun) {
  if ((await fs.lstat(indexFile)).isSymbolicLink()) throw new Error('Environment index is a symlink');
  const index = await readJson(indexFile);
  if (index.schemaVersion !== 1 || !Array.isArray(index.environments)) throw new Error('Invalid environment index');
  const selected = ids.map((id) => {
    const entry = index.environments.find((item) => item.id === id);
    if (!entry || JSON.stringify(environmentPaths(id)) !== JSON.stringify({ home: entry.home, codexHome: entry.codexHome, xdgConfigHome: entry.xdgConfigHome })
      || entry.manifest !== `./environments/${id}/environment.json`) throw new Error(`Unknown or invalid environment: ${id}`);
    return { id, home: path.join(projectRoot, entry.home), codexHome: path.join(projectRoot, entry.codexHome), xdgConfigHome: path.join(projectRoot, entry.xdgConfigHome) };
  });
  await run(process.execPath, [path.join(projectRoot, 'bootstrap', 'verify.mjs')]);
  for (const environment of selected) {
    const manifest = await readJson(path.join(environment.home, 'environment.json'));
    environment.source = manifest.source;
    environment.contentHash = manifest.contentHash;
  }
  if (!dryRun) {
    for (const environment of selected) {
      if (!(await exists(path.join(environment.codexHome, 'auth.json')))) {
        throw new Error(`${environment.id}: no isolated auth.json; run pnpm run auth:copy or log in inside this environment`);
      }
    }
  }
  return { selected, codexVersion: index.codexVersion };
}

async function copyFixture(source, destination) {
  for (const name of await fs.readdir(source)) {
    await fs.cp(path.join(source, name), path.join(destination, name), { recursive: true, errorOnExist: true, force: false });
  }
}

export function buildCodexArgs(options, workDir, sessionId = null) {
  const args = sessionId
    ? ['exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode=workspace-write', '-c', 'approval_policy=never']
    : ['exec', '--json', '--skip-git-repo-check', '-C', workDir, '-s', 'workspace-write', '-c', 'approval_policy=never'];
  if (!options.feedbackRepairs && !sessionId) args.splice(2, 0, '--ephemeral');
  args.push('-c', 'sandbox_workspace_write.network_access=true');
  if (options.model) args.push('-m', options.model);
  if (options.reasoning) args.push('-c', `model_reasoning_effort=${options.reasoning}`);
  if (sessionId) args.push(sessionId);
  args.push('-');
  return args;
}

async function executeCodex({ args, prompt, cwd, env, stdoutPath, stderrPath, timeoutSeconds }) {
  const [stdoutFile, stderrFile] = await Promise.all([fs.open(stdoutPath, 'wx', 0o600), fs.open(stderrPath, 'wx', 0o600)]);
  try {
    return await new Promise((resolve) => {
      let timedOut = false;
      let spawnError = null;
      const child = spawn('codex', args, { cwd, env, detached: true, stdio: ['pipe', stdoutFile.fd, stderrFile.fd] });
      child.stdin.on('error', () => {});
      child.stdin.end(prompt);
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') spawnError = error.message; } }
      }, timeoutSeconds * 1000);
      const forceTimer = setTimeout(() => { if (timedOut && child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') spawnError = error.message; } } }, timeoutSeconds * 1000 + 5000);
      child.on('error', (error) => { spawnError = error.message; });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        clearTimeout(forceTimer);
        if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') spawnError = error.message; } }
        resolve({ exitCode: code, signal, timedOut, spawnError });
      });
    });
  } finally {
    await Promise.all([stdoutFile.close(), stderrFile.close()]);
  }
}

async function runOne(options, inputs, environment, codexVersion, sequence, repetition, result, repair = null) {
  const id = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`;
  const environmentPath = environmentDirectory(options, environment.id, repetition);
  const attemptNumber = repair?.attemptNumber ?? 1;
  const outputDir = path.join(result.outputDir, 'attempts', environmentPath, `attempt-${String(attemptNumber).padStart(2, '0')}`);
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  const workDir = path.join(result.workDir, environmentPath);
  const record = {
    schemaVersion: 1, id, taskId: options.taskId, environmentId: environment.id,
    repetition, sequence, inputHash: inputs.inputHash,
    taskSource: options.taskSource ?? null, taskManifestHash: options.taskManifestHash ?? null,
    promptFile: inputs.originalPromptFile ?? inputs.promptFile, fixtureDir: inputs.originalFixtureDir, workDir,
    codexVersion, environmentSource: environment.source, environmentContentHash: environment.contentHash,
    model: options.model, reasoningEffort: options.reasoning ?? null,
    options: { sandbox: 'workspace-write', approvalPolicy: 'never', networkAccess: true, timeoutSeconds: options.timeoutSeconds, ephemeral: !options.feedbackRepairs },
    browser: options.browser,
    trialId: repair?.trialId ?? null, attemptNumber, sessionId: repair?.sessionId ?? null,
    startedAt, finishedAt: null, durationMs: null, status: 'failed', exitCode: null,
    signal: null, timedOut: false, error: null,
    usage: { inputTokens: null, outputTokens: null, cachedInputTokens: null, reason: 'not_collected' },
    logs: { jsonl: 'events.jsonl', stderr: 'stderr.txt' }, artifact: null,
    selfValidation: null,
  };
  try {
    if (attemptNumber === 1) await fs.mkdir(workDir, { recursive: true, mode: 0o700 });
    await assertSafeWorkPath(workDir);
    if (attemptNumber === 1) await copyFixture(inputs.fixtureDir, workDir);
    const args = buildCodexArgs(options, workDir, repair?.sessionId);
    console.log(`START ${options.taskId} ${environment.id} repetition ${repetition} attempt ${record.attemptNumber}: work ${workDir}; log ${path.join(outputDir, 'events.jsonl')}`);
    const outcome = await executeCodex({
      args, prompt: repair?.prompt ?? inputs.prompt, cwd: workDir,
      env: { ...process.env, HOME: environment.home, CODEX_HOME: environment.codexHome, XDG_CONFIG_HOME: environment.xdgConfigHome,
        PLAYWRIGHT_BROWSERS_PATH: options.browser.browsersPath, PWD: workDir },
      stdoutPath: path.join(outputDir, 'events.jsonl'), stderrPath: path.join(outputDir, 'stderr.txt'),
      timeoutSeconds: options.timeoutSeconds,
    });
    record.exitCode = outcome.exitCode;
    record.signal = outcome.signal;
    record.timedOut = outcome.timedOut;
    record.error = outcome.spawnError;
    record.status = outcome.timedOut ? 'timed_out' : outcome.exitCode === 0 ? 'completed' : 'failed';
    record.usage = await collectUsage(path.join(outputDir, 'events.jsonl'));
    record.sessionId = await collectSessionId(path.join(outputDir, 'events.jsonl')) ?? record.sessionId;
  } catch (error) {
    record.error = error.message;
  } finally {
    try { record.selfValidation = await collectSelfValidation(workDir, path.join(outputDir, 'events.jsonl'), outputDir); }
    catch (error) { record.selfValidation = { status: 'collection_failed', error: error.message }; }
    try {
      if (await exists(workDir)) {
        const artifactDir = path.join(outputDir, 'artifact');
        const sha256 = await copyEvaluationSnapshot(workDir, artifactDir);
        record.artifact = { directory: artifactDir, sha256 };
      }
    } catch (error) { record.artifact = { error: error.message }; }
    record.finishedAt = new Date().toISOString();
    record.durationMs = Date.parse(record.finishedAt) - Date.parse(startedAt);
    await writeJsonAtomic(path.join(outputDir, 'run.json'), record);
  }
  console.log(`${record.status.toUpperCase()} ${environment.id} repetition ${repetition}: ${outputDir}`);
  return { ...record, recordFile: path.join(outputDir, 'run.json') };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(help); return; }
  const prepared = options.taskDir ? await prepareTask(options.taskDir) : null;
  try {
    if (prepared) {
      options.taskId = prepared.manifest.id;
      options.taskSource = prepared.manifest.source;
      options.taskManifestHash = prepared.manifestHash;
      options.promptFile = prepared.promptFile;
      options.fixtureDir = prepared.fixtureDir;
    }
    const inputs = await inspectInputs(options);
    const { selected, codexVersion } = await inspectEnvironments(options.environments, options.dryRun);
    const browserExecutable = chromium.executablePath();
    if (!(await exists(browserExecutable))) throw new Error(`Playwright Chromium is missing: ${browserExecutable}`);
    options.browser = {
      engine: 'chromium', playwrightVersion: (await readJson(path.join(projectRoot, 'node_modules', 'playwright', 'package.json'))).version,
      executable: browserExecutable, executableSha256: createHash('sha256').update(await fs.readFile(browserExecutable)).digest('hex'),
      browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), '.cache', 'ms-playwright'),
    };
    const plan = Array.from({ length: options.repeats }, (_, index) => selected.map((environment) => ({ environment, repetition: index + 1 }))).flat();
    if (options.feedbackRepairs && options.taskId !== 'FE-01') throw new Error('Feedback repairs currently support FE-01 only');
    console.log(`Task ${options.taskId}; input SHA-256 ${inputs.inputHash}; ${plan.length} independent trial(s); up to ${plan.length * (options.feedbackRepairs + 1)} Codex attempt(s)${options.feedbackRepairs ? `; objective diagnostic stop score ${options.diagnosticTargetScore}` : ''}${options.evaluateQuality ? `; up to ${plan.length * (options.feedbackRepairs + 1)} AI quality grading call(s)` : ''}: ${plan.map(({ environment }) => environment.id).join(', ')}`);
    if (options.dryRun) return;
    await checkStorageCommands();
    await executePlan(options, inputs, prepared, plan, codexVersion);
  } finally {
    if (prepared) await prepared.cleanup();
  }
}

async function checkStorageCommands() {
  await Promise.all(['zip', 'unzip', 'flock'].map((command) =>
    run('sh', ['-c', 'command -v "$1" >/dev/null', 'sh', command]).catch(() => {
      throw new Error(`Required benchmark storage command is missing: ${command}`);
    })));
}

export async function executePlan(options, inputs, prepared, plan, codexVersion) {
  const instructions = new Map(await Promise.all(plan
    .filter(({ repetition }) => repetition === 1)
    .map(async ({ environment }) => [environment.id, await captureInstructions(environment)])));
  const result = await createRunDirectories(options.taskId);
  const summary = {
    schemaVersion: 1, taskId: options.taskId, run: result.name, status: 'running',
    workDir: result.workDir, startedAt: new Date().toISOString(), finishedAt: null,
    userChecklist: 'user-checklist.md', runs: [], trials: [], snapshots: [], comparisons: [],
    qualityEvaluation: null, error: null,
  };
  const save = () => saveResult(result, summary);
  await save();
  console.log(`Work: ${result.workDir}\nResult: ${path.join(result.outputDir, 'result.json')}`);
  let snapshotDir;
  try {
    await createUserChecklist(options, result);
    snapshotDir = await fs.mkdtemp(path.join(result.workDir, '.input-'));
    await copyFixture(inputs.fixtureDir, snapshotDir);
    const snapshot = await inspectInputs({ promptFile: inputs.promptFile, fixtureDir: snapshotDir });
    if (snapshot.inputHash !== inputs.inputHash) throw new Error('Fixture changed while preparing the run');
    const stableInputs = { ...inputs, fixtureDir: snapshotDir,
      originalFixtureDir: prepared?.taskDir ?? inputs.fixtureDir,
      originalPromptFile: prepared?.originalPromptFile ?? inputs.promptFile };

    let failures = 0;
    const attempts = new Map();
    const assessments = new Map();
    const firstRuns = [];
    const finalRuns = [];
    const relative = (file) => path.relative(result.outputDir, file);

    for (const [index, { environment, repetition }] of plan.entries()) {
      let latest;
      const execute = async (repair = null) => {
        const runRecord = await runOne(options, stableInputs, environment, codexVersion, index + 1, repetition, result, repair);
        attempts.set(runRecord.id, runRecord);
        if (!latest) firstRuns.push(runRecord);
        latest = runRecord;
        const { id, environmentId, attemptNumber, status, durationMs, usage, workDir, recordFile } = runRecord;
        summary.runs.push({ id, environmentId, repetition, attemptNumber, status, durationMs, usage, workDir, record: relative(recordFile) });
        await save();
        return runRecord;
      };

      try {
        if (options.feedbackRepairs) {
          const trialDir = path.join(result.outputDir, 'trials', environmentDirectory(options, environment.id, repetition));
          summary.trials.push(relative(path.join(trialDir, 'trial.json')));
          const { trial } = await runTrial({
            taskId: options.taskId, environmentId: environment.id, repetition, inputHash: stableInputs.inputHash,
            maxFeedbackRounds: options.feedbackRepairs, outputDirectory: trialDir,
            targetKind: 'objective_diagnostic', targetScore: options.diagnosticTargetScore,
            execute,
            evaluate: async (runRecord) => {
              const evaluationDir = await fs.mkdtemp(path.join(result.workDir, '.evaluation-'));
              try {
                await copyFixture(runRecord.workDir, evaluationDir);
                const assessment = await evaluateTaskRun({ ...runRecord, workDir: evaluationDir });
                assessments.set(runRecord.id, assessment);
                return gradeTaskAssessment(runRecord.taskId, assessment);
              } finally {
                await fs.rm(evaluationDir, { recursive: true, force: true });
              }
            },
          });
          if (trial.status !== 'diagnostic_target_reached') failures += 1;
          console.log(`Trial ${environment.id} repetition ${repetition}: ${trial.status}; ${trialDir}`);
        } else if ((await execute()).status !== 'completed') {
          failures += 1;
        }
      } finally {
        if (latest) {
          finalRuns.push(latest);
          const archive = await snapshotFinalAttempt(options, result, latest, instructions.get(environment.id));
          summary.snapshots.push(archive);
          if (archive.error) failures += 1;
          await save();
        }
      }
    }

    if (finalRuns.length > 1) {
      const stages = options.feedbackRepairs ? [['first', firstRuns]] : [['final', finalRuns]];
      if (options.feedbackRepairs && finalRuns.some((entry, index) => entry.id !== firstRuns[index].id)) stages.push(['final', finalRuns]);
      for (const [stage, runs] of stages) {
        const { outputDir } = await compareRuns(runs, {
          outputDirectory: path.join(result.outputDir, 'comparisons', stage),
          assess: options.feedbackRepairs ? async (entry) => assessments.get(entry.id) : undefined,
        });
        summary.comparisons.push(relative(path.join(outputDir, 'comparison.json')));
        await save();
        console.log(`Comparison: ${path.join(outputDir, 'summary.md')}`);
      }
    }
    if (options.evaluateQuality) {
      const { outputDir, record } = await reevaluateRuns([...attempts.values()], {
        judgeHome: options.judgeHome,
        outputDirectory: path.join(result.outputDir, 'quality'),
      });
      summary.qualityEvaluation = relative(path.join(outputDir, 'evaluation.json'));
      if (record.entries.some((entry) => entry.aiCode.status === 'error')) failures += 1;
      console.log(`Quality evaluation: ${path.join(outputDir, 'evaluation.json')}`);
    }
    if (failures) throw new Error(`${failures} run, evaluation, or archive failure(s); inspect ${path.join(result.outputDir, 'result.json')}`);
    summary.status = 'completed';
  } catch (error) {
    summary.status = 'failed';
    summary.error = error.message;
    throw error;
  } finally {
    summary.finishedAt = new Date().toISOString();
    await save();
    if (snapshotDir) await fs.rm(snapshotDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Runner failed: ${error.message}`); process.exitCode = 1; });
}
