import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildCodexArgs, parseArgs } from './index.mjs';
import { collectSessionId, collectUsage } from './execution/usage.mjs';
import { runTrial } from './execution/trial.mjs';
import { collectSelfValidation } from './execution/self-validation.mjs';
import { formatEvents, supportsColor, withColorizedOutput } from './execution/terminal.mjs';

const args = ['--task-id', 'sample', '--prompt-file', 'prompt.md', '--fixture-dir', 'fixture', '--environments', 'baseline,codex-workspace'];

test('terminal events color only event keywords in supported terminals', () => {
  const stream = { isTTY: true };
  const environment = {};
  const formatted = formatEvents('START task\nResult: /tmp/result\nFAILED run\nWARNING retry', { stream, environment });
  assert.equal(formatted, '\u001B[1;34mSTART\u001B[0m task\n\u001B[1;92mResult\u001B[0m: /tmp/result\n\u001B[1;31mFAILED\u001B[0m run\n\u001B[1;33mWARNING\u001B[0m retry');
  assert.equal(formatEvents('COMPLETED result', { stream: { isTTY: false }, environment }), 'COMPLETED result');
  assert.equal(formatEvents('ERROR result', { stream, environment: { NO_COLOR: '' } }), 'ERROR result');
  assert.equal(supportsColor(stream, environment), true);
  assert.equal(supportsColor({ isTTY: false }, environment), false);
  assert.equal(supportsColor(stream, { TERM: 'dumb' }), false);
});

test('terminal output wrapper restores the stream after evaluator output', async () => {
  let output = '';
  const stream = { isTTY: true, write(chunk) { output += chunk; return true; } };
  await withColorizedOutput(async () => {
    stream.write('Starting evaluation\n');
    stream.write('Running 2 test cases\n');
  }, stream, {});
  stream.write('COMPLETED outside wrapper');
  assert.equal(output, '\u001B[1;34mStarting\u001B[0m evaluation\n\u001B[1;34mRunning\u001B[0m 2 test cases\nCOMPLETED outside wrapper');
});

test('runner limits invocation size and rejects duplicate environments', () => {
  assert.equal(parseArgs(args).model, 'gpt-6.2-sol');
  assert.equal(parseArgs(args).environments.length, 2);
  assert.equal(parseArgs(['--task', 'tasks/FE-01', '--environments', 'baseline']).taskDir, 'tasks/FE-01');
  assert.throws(() => parseArgs(['--task', 'tasks/FE-01', ...args]), /cannot be combined/);
  assert.throws(() => parseArgs([...args, '--repeats', '2']), /Maximum three runs/);
  assert.throws(() => parseArgs([...args.slice(0, -1), 'baseline,baseline']), /unique/);
  assert.equal(parseArgs(['--task', 'tasks/FE-01', '--environments', 'baseline']).evaluateQuality, true);
  assert.equal(parseArgs(['--task', 'tasks/FE-01', '--environments', 'baseline', '--evaluate-quality']).evaluateQuality, true);
  assert.throws(() => parseArgs([...args, '--evaluate-quality']), /requires --task/);
  assert.throws(() => parseArgs([...args, '--judge-home', '/tmp/judge']), /requires --task/);
  assert.equal(parseArgs(['--task', 'tasks/FE-01', '--environments', 'baseline', '--judge-home', '/tmp/judge']).judgeHome, '/tmp/judge');
});

test('usage sums completed turns and preserves missing measurements', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-usage-'));
  try {
    const file = path.join(directory, 'events.jsonl');
    await fs.writeFile(file, [
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 8, output_tokens: 3, cached_input_tokens: 2 } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 4, cached_input_tokens: 1 } }),
    ].join('\n'));
    assert.deepEqual(await collectUsage(file), { inputTokens: 13, outputTokens: 7, cachedInputTokens: 3, reason: null });
    await fs.writeFile(file, JSON.stringify({ type: 'turn.failed' }));
    assert.deepEqual(await collectUsage(file), { inputTokens: null, outputTokens: null, cachedInputTokens: null, reason: 'missing_usage_events' });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('runner validates feedback repair limits without a token stopping option', () => {
  const taskArgs = ['--task', 'tasks/FE-01', '--environments', 'baseline'];
  assert.equal(parseArgs([...taskArgs, '--feedback-repairs', '2']).feedbackRepairs, 2);
  assert.equal(parseArgs([...taskArgs, '--feedback-repairs', '1']).diagnosticTargetScore, 50);
  assert.equal(parseArgs([...taskArgs, '--feedback-repairs', '1', '--diagnostic-target-score', '60']).diagnosticTargetScore, 60);
  assert.throws(() => parseArgs([...taskArgs, '--feedback-repairs', '3']), /between 0 and 2/);
  assert.throws(() => parseArgs([...args, '--feedback-repairs', '1']), /require --task/);
  assert.throws(() => parseArgs([...taskArgs, '--feedback-repairs', '1', '--max-total-tokens', '200000']), /Unknown/);
  assert.throws(() => parseArgs([...taskArgs, '--diagnostic-target-score', '50']), /requires --feedback-repairs/);
});

test('initial run and feedback repair use distinct Codex commands and explicit session ID', () => {
  const options = { feedbackRepairs: 1, model: 'gpt-6', reasoning: 'low' };
  const first = buildCodexArgs(options, '/tmp/result');
  const repair = buildCodexArgs(options, '/tmp/result', 'session-1');
  assert.deepEqual(first.slice(0, 7), ['exec', '--json', '--skip-git-repo-check', '-C', '/tmp/result', '-s', 'workspace-write']);
  assert.equal(first.includes('--ephemeral'), false);
  assert.deepEqual(repair.slice(0, 4), ['exec', 'resume', '--json', '--skip-git-repo-check']);
  assert.equal(repair.includes('-C'), false);
  assert.deepEqual(repair.slice(-2), ['session-1', '-']);
  assert.equal(repair.includes('sandbox_mode=workspace-write'), true);
  assert.equal(first.includes('sandbox_workspace_write.network_access=true'), true);
  assert.equal(repair.includes('sandbox_workspace_write.network_access=true'), true);
});

test('self-validation preserves browser evidence separately and records observed outcome', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-self-validation-'));
  try {
    const workDir = path.join(directory, 'work');
    const outputDir = path.join(directory, 'run');
    await fs.mkdir(path.join(workDir, 'screenshots', 'playwright'), { recursive: true });
    await fs.mkdir(outputDir);
    await fs.writeFile(path.join(workDir, 'check.mjs'), "import { chromium } from 'playwright';\nawait chromium.launch();\n");
    await fs.writeFile(path.join(workDir, 'screenshots', 'playwright', 'mobile.png'), 'image');
    await fs.writeFile(path.join(outputDir, 'events.jsonl'), `${JSON.stringify({ type: 'item.completed', item: {
      type: 'command_execution', command: 'node check.mjs', exit_code: 0, status: 'completed' } })}\n`);
    const result = await collectSelfValidation(workDir, path.join(outputDir, 'events.jsonl'), outputDir);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.screenshotCount, 1);
    assert.equal(result.browserCommandCount, 1);
    assert.equal(await fs.readFile(path.join(outputDir, 'self-validation', 'screenshots', 'playwright', 'mobile.png'), 'utf8'), 'image');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('session id is read from Codex JSONL events', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-session-'));
  try {
    const file = path.join(directory, 'events.jsonl');
    await fs.writeFile(file, `${JSON.stringify({ type: 'thread.started', thread_id: 'session-1' })}\n`);
    assert.equal(await collectSessionId(file), 'session-1');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('feedback trial records each score and token delta with cumulative values', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-trial-'));
  const scores = [60, 85, 92];
  const tokens = [50000, 20000, 10000];
  const prompts = [];
  try {
    const { trial } = await runTrial({
      taskId: 'FE-01', environmentId: 'baseline', repetition: 1, inputHash: 'same',
      outputRoot: directory,
      execute: async ({ attemptNumber, prompt, sessionId, workDir }) => {
        prompts.push(prompt);
        assert.equal(sessionId, attemptNumber === 1 ? null : 'session-1');
        assert.equal(workDir, attemptNumber === 1 ? null : '/tmp/benchmark-result');
        return { id: `run-${attemptNumber}`, taskId: 'FE-01', environmentId: 'baseline', inputHash: 'same',
          status: 'completed', sessionId: 'session-1', workDir: '/tmp/benchmark-result', durationMs: 1000,
          usage: { inputTokens: tokens[attemptNumber - 1] - 100, outputTokens: 100,
            cachedInputTokens: 10, reason: null } };
      },
      evaluate: async (run) => ({ scope: 'full_quality', complete: true, mandatoryPassed: run.id === 'run-3',
        score: scores[Number(run.id.at(-1)) - 1], feedback: run.id === 'run-3' ? [] : [{ id: 'F01', message: 'Filter failed' }] }),
    });
    assert.equal(trial.status, 'passed');
    assert.equal(trial.firstPassAttempt, 3);
    assert.deepEqual(trial.attempts.map((item) => item.evaluation.score), scores);
    assert.deepEqual(trial.attempts.map((item) => item.scoreDelta), [null, 25, 7]);
    assert.deepEqual(trial.attempts.map((item) => item.usage.inputTokens + item.usage.outputTokens), tokens);
    assert.deepEqual(trial.attempts.map((item) => item.cumulativeUsage.inputTokens + item.cumulativeUsage.outputTokens), [50000, 70000, 80000]);
    assert.equal(trial.firstAttempt.score, 60);
    assert.match(prompts[1], /Filter failed/);
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, trial.id, 'trial.json'), 'utf8')).attempts.length, 3);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('incomplete quality remains ungraded and stops when objective feedback is exhausted', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-trial-'));
  try {
    const { trial } = await runTrial({ taskId: 'FE-01', environmentId: 'baseline', repetition: 1,
      inputHash: 'same', outputRoot: directory,
      execute: async () => ({ id: 'run-1', taskId: 'FE-01', environmentId: 'baseline', inputHash: 'same',
        status: 'completed', sessionId: 'session-1', workDir: '/tmp/result', durationMs: 1,
        usage: { inputTokens: 10, outputTokens: 1, cachedInputTokens: 0, reason: null } }),
      evaluate: async () => ({ scope: 'objective_diagnostic', complete: false, mandatoryPassed: true, score: 100, feedback: [] }),
    });
    assert.equal(trial.status, 'evaluation_incomplete');
    assert.equal(trial.attempts.length, 1);
    assert.equal(trial.firstAttempt.passed, false);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('large token use does not stop a requested feedback repair', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-trial-'));
  let calls = 0;
  try {
    const { trial } = await runTrial({ taskId: 'FE-01', environmentId: 'baseline', repetition: 1,
      inputHash: 'same', maxFeedbackRounds: 1, outputRoot: directory,
      execute: async () => {
        calls += 1;
        return { id: `run-${calls}`, taskId: 'FE-01', environmentId: 'baseline', inputHash: 'same',
          status: 'completed', sessionId: 'session-1', workDir: '/tmp/result', durationMs: 1,
          usage: { inputTokens: calls === 1 ? 285621 : 20000, outputTokens: calls === 1 ? 2745 : 500,
            cachedInputTokens: calls === 1 ? 259584 : 10000, reason: null } };
      },
      evaluate: async () => ({ scope: 'full_quality', complete: true, mandatoryPassed: calls === 2,
        score: calls === 1 ? 40 : 92, feedback: calls === 1 ? [{ id: 'F01', message: 'Failed' }] : [] }),
    });
    assert.equal(calls, 2);
    assert.equal(trial.status, 'passed');
    assert.equal(trial.attempts[0].cumulativeUsage.inputTokens + trial.attempts[0].cumulativeUsage.outputTokens, 288366);
    assert.equal(trial.attempts[1].cumulativeUsage.inputTokens + trial.attempts[1].cumulativeUsage.outputTokens, 308866);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('missing token measurements remain null without stopping feedback repair', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-trial-'));
  let calls = 0;
  try {
    const { trial } = await runTrial({ taskId: 'FE-01', environmentId: 'baseline', repetition: 1,
      inputHash: 'same', maxFeedbackRounds: 1, outputRoot: directory,
      execute: async () => {
        calls += 1;
        return { id: `run-${calls}`, taskId: 'FE-01', environmentId: 'baseline', inputHash: 'same',
          status: 'completed', sessionId: 'session-1', workDir: '/tmp/result', durationMs: 1,
          usage: calls === 1
            ? { inputTokens: null, outputTokens: null, cachedInputTokens: null, reason: 'missing_usage_events' }
            : { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, reason: null } };
      },
      evaluate: async () => ({ scope: 'objective_diagnostic', complete: false, mandatoryPassed: false,
        score: calls === 1 ? 40 : 80, feedback: calls === 1 ? [{ id: 'FE01-F02', message: 'Failed' }] : [] }),
      targetKind: 'objective_diagnostic', targetScore: 50,
    });
    assert.equal(calls, 2);
    assert.equal(trial.status, 'diagnostic_target_reached');
    assert.equal(trial.attempts[1].cumulativeUsage.inputTokens, null);
    assert.equal(trial.attempts[1].cumulativeUsage.outputTokens, null);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('low diagnostic target stops early without claiming full-quality pass', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-trial-'));
  let calls = 0;
  try {
    const { trial } = await runTrial({ taskId: 'FE-01', environmentId: 'baseline', repetition: 1,
      inputHash: 'same', targetKind: 'objective_diagnostic', targetScore: 50,
      outputRoot: directory,
      execute: async () => {
        calls += 1;
        return { id: `run-${calls}`, taskId: 'FE-01', environmentId: 'baseline', inputHash: 'same',
          status: 'completed', sessionId: 'session-1', workDir: '/tmp/result', durationMs: 1,
          usage: { inputTokens: 100, outputTokens: 5, cachedInputTokens: 0, reason: null } };
      },
      evaluate: async () => ({ scope: 'objective_diagnostic', complete: false,
        mandatoryPassed: false, score: 55, feedback: [{ id: 'F01', message: 'Failed' }] }),
    });
    assert.equal(calls, 1);
    assert.equal(trial.status, 'diagnostic_target_reached');
    assert.equal(trial.firstTargetAttempt, 1);
    assert.equal(trial.firstPassAttempt, null);
    assert.equal(trial.firstAttempt.passed, false);
    assert.equal(trial.firstAttempt.targetReached, true);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
