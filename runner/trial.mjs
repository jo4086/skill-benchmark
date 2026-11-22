import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../bootstrap/common.mjs';
import { taskResultsDirectory } from './storage.mjs';

function addUsage(total, usage) {
  const next = {};
  for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens']) {
    next[key] = total[key] === null || !Number.isSafeInteger(usage?.[key])
      ? null : total[key] + usage[key];
  }
  next.reason = Object.values(next).some((value) => value === null)
    ? usage?.reason ?? total.reason ?? 'missing_attempt_usage' : null;
  return next;
}

function scoreChange(previous, current) {
  return Number.isFinite(previous) && Number.isFinite(current) ? current - previous : null;
}

export function feedbackPrompt(evaluation) {
  if (!Array.isArray(evaluation.feedback) || !evaluation.feedback.length) return null;
  return [
    'Improve the existing project in this working directory. Keep the original task requirements.',
    'The previous result did not meet the benchmark target. Address these observed issues:',
    ...evaluation.feedback.slice(0, 30).map((item) => `- ${String(item.id).slice(0, 80)}: ${String(item.message).slice(0, 1200)}`),
    'Verify the changes and preserve the working features.',
  ].join('\n');
}

export async function runTrial({ taskId, environmentId, repetition, inputHash, maxFeedbackRounds = 2,
  targetScore = 90, targetKind = 'full_quality', execute, evaluate, outputRoot = taskResultsDirectory(taskId), outputDirectory }) {
  if (!Number.isSafeInteger(maxFeedbackRounds) || maxFeedbackRounds < 0 || maxFeedbackRounds > 2) {
    throw new Error('maxFeedbackRounds must be between 0 and 2');
  }
  if (!Number.isFinite(targetScore) || targetScore < 0 || targetScore > 100) throw new Error('targetScore must be between 0 and 100');
  if (!['full_quality', 'objective_diagnostic'].includes(targetKind)) throw new Error('Invalid targetKind');
  const id = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`;
  const outputDir = outputDirectory ?? path.join(outputRoot, id);
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const trial = {
    schemaVersion: 1, id, taskId, environmentId, repetition, inputHash,
    mode: 'same-session-feedback-repair', targetKind, targetScore, maxFeedbackRounds,
    status: 'running', attempts: [],
    cumulativeUsage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reason: null },
    cumulativeDurationMs: 0, firstAttempt: null, firstPassAttempt: null, firstTargetAttempt: null,
  };
  const save = () => writeJsonAtomic(path.join(outputDir, 'trial.json'), trial);
  await save();
  let prompt = null;
  let sessionId = null;
  let workDir = null;
  try {
    for (let attemptNumber = 1; attemptNumber <= maxFeedbackRounds + 1; attemptNumber += 1) {
      const run = await execute({ trialId: id, attemptNumber, prompt, sessionId, workDir });
      if (run.taskId !== taskId || run.environmentId !== environmentId || run.inputHash !== inputHash) {
        throw new Error('Attempt identity differs from the trial');
      }
      if (attemptNumber > 1 && (run.workDir !== workDir || run.sessionId !== sessionId)) {
        throw new Error('Repair attempt did not preserve the work directory and Codex session');
      }
      workDir = run.workDir;
      sessionId = run.sessionId;
      const evaluation = await evaluate(run);
      if (!evaluation || !['full_quality', 'objective_diagnostic'].includes(evaluation.scope)
        || typeof evaluation.complete !== 'boolean' || typeof evaluation.mandatoryPassed !== 'boolean'
        || !Array.isArray(evaluation.feedback) || (evaluation.score !== null
          && (!Number.isFinite(evaluation.score) || evaluation.score < 0 || evaluation.score > 100))
        || (evaluation.complete && evaluation.score === null)) throw new Error('Invalid evaluation result');
      const previousScore = trial.attempts.at(-1)?.evaluation.score ?? null;
      trial.cumulativeUsage = addUsage(trial.cumulativeUsage, run.usage);
      trial.cumulativeDurationMs += run.durationMs ?? 0;
      const attempt = {
        attemptNumber, kind: attemptNumber === 1 ? 'first_attempt' : 'feedback_repair',
        runId: run.id, runStatus: run.status, sessionId: run.sessionId, workDir: run.workDir,
        feedbackFromPrevious: attemptNumber === 1 ? null : trial.attempts.at(-1).evaluation.feedback,
        usage: run.usage, cumulativeUsage: { ...trial.cumulativeUsage },
        durationMs: run.durationMs, cumulativeDurationMs: trial.cumulativeDurationMs,
        evaluation, scoreDelta: scoreChange(previousScore, evaluation.score),
      };
      trial.attempts.push(attempt);
      const runReady = run.status === 'completed' && Boolean(run.sessionId) && Boolean(run.workDir);
      const fullPass = runReady && evaluation.scope === 'full_quality' && evaluation.complete
        && evaluation.mandatoryPassed && evaluation.score >= targetScore;
      const diagnosticTarget = targetKind === 'objective_diagnostic' && evaluation.scope === 'objective_diagnostic'
        && runReady && Number.isFinite(evaluation.score) && evaluation.score >= targetScore;
      if (attemptNumber === 1) trial.firstAttempt = { score: evaluation.score, usage: run.usage,
        passed: targetKind === 'full_quality' && fullPass, targetReached: targetKind === 'objective_diagnostic' ? diagnosticTarget : fullPass };
      if (!runReady) trial.status = 'run_failed';
      else if (diagnosticTarget) {
        trial.status = 'diagnostic_target_reached';
        trial.firstTargetAttempt = attemptNumber;
      } else if (targetKind === 'full_quality' && fullPass) {
        trial.status = 'passed';
        trial.firstPassAttempt = attemptNumber;
        trial.firstTargetAttempt = attemptNumber;
      } else if (attemptNumber > maxFeedbackRounds) trial.status = targetKind === 'objective_diagnostic'
        ? 'diagnostic_target_missed' : evaluation.complete ? 'quality_failed' : 'evaluation_incomplete';
      else {
        prompt = feedbackPrompt(evaluation);
        if (!prompt) trial.status = targetKind === 'objective_diagnostic'
          ? 'diagnostic_feedback_unavailable' : evaluation.complete ? 'feedback_unavailable' : 'evaluation_incomplete';
      }
      await save();
      if (trial.status !== 'running') break;
  }
  } catch (error) {
    trial.status = 'error';
    trial.error = error.message;
    await save();
    throw error;
  }
  return { trial, outputDir };
}
