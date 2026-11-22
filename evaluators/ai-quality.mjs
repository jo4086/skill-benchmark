import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../bootstrap/common.mjs';
import { hashEvaluationSnapshot } from './snapshot.mjs';

export const judgeConfig = Object.freeze({
  promptfooVersion: '0.126.0', sdkVersion: '0.167.0',
  model: 'gpt-6.1-sol', reasoningEffort: 'medium', rubricVersion: 2,
  sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false,
});

export const codeRubric = [
  'Review only the implementation source files in the current workspace. Ignore developer identity and any benchmark variant.',
  'Use this fixed 100-point rubric: structure 25, readability 20, maintainability 25, unnecessary complexity 15, responsibility separation 15.',
  'For each dimension award an integer from 0 to its maximum: 0 means severe defects; about 25% means major defects; 50% means mixed; 75% means sound with minor issues; 100% means clear and well justified.',
  'Do not reward extra files or abstractions merely for existing. Penalize duplicated logic, hidden coupling, unclear naming, fragile changes, and complexity without a requirement.',
  'The final score must equal the sum of the five dimensions divided by 100. In the reason include exactly five lines in this form: structure: N/25 at file:line — concrete evidence; readability: N/20 at file:line — evidence; maintainability: N/25 at file:line — evidence; complexity: N/15 at file:line — evidence; responsibility: N/15 at file:line — evidence. Mention positive evidence too. If code is too small for a dimension, assess proportionately.',
  'Use read-only shell commands to inspect implementation files in this workspace before grading. Do not modify files, browse the web, or inspect files outside this workspace.',
].join('\n');
export const codeRubricSha256 = createHash('sha256').update(codeRubric).digest('hex');

function rubricEvidence(reason, score) {
  const weights = { structure: 25, readability: 20, maintainability: 25, complexity: 15, responsibility: 15 };
  const dimensions = {};
  for (const [name, maximum] of Object.entries(weights)) {
    const line = reason.split('\n').find((item) => new RegExp(`^\\s*${name}:`, 'i').test(item));
    const match = line?.match(new RegExp(`^\\s*${name}:\\s*(\\d+)\\s*/\\s*${maximum}\\s+at\\s+([^\\s:]+):(\\d+)\\s*[—-]\\s*(.+)$`, 'i'));
    if (!match || Number(match[1]) > maximum) return null;
    dimensions[name] = { points: Number(match[1]), maximum, file: match[2], line: Number(match[3]), evidence: match[4] };
  }
  return Math.abs(Object.values(dimensions).reduce((sum, item) => sum + item.points, 0) - score) <= 1 ? dimensions : null;
}

export async function evaluateAiCodeQuality(workDir, { judgeHome, evaluate } = {}) {
  if (!judgeHome || !path.isAbsolute(judgeHome)) throw new Error('An absolute isolated judgeHome is required');
  const homeStat = await fs.lstat(judgeHome);
  if (!homeStat.isDirectory()) throw new Error('judgeHome must be a directory');
  if (judgeHome === projectRoot || judgeHome.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error('Judge home must be outside the benchmark repository');
  }
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'skills', 'hooks', '.agents', '.codex', 'config.toml']) {
    if (await fs.stat(path.join(judgeHome, name)).then(() => true, () => false)) {
      throw new Error(`Judge home contains comparison instructions: ${name}`);
    }
  }
  if (workDir === judgeHome || workDir.startsWith(`${judgeHome}${path.sep}`) || judgeHome.startsWith(`${workDir}${path.sep}`)) {
    throw new Error('Judge home overlaps evaluated code');
  }
  const before = await hashEvaluationSnapshot(workDir);
  const provider = {
    id: 'openai:codex-sdk',
    config: {
      model: judgeConfig.model, model_reasoning_effort: judgeConfig.reasoningEffort,
      working_dir: workDir, sandbox_mode: judgeConfig.sandboxMode,
      approval_policy: judgeConfig.approvalPolicy, skip_git_repo_check: true,
      inherit_process_env: false, network_access_enabled: false, web_search_mode: 'disabled',
      cli_env: { HOME: judgeHome, CODEX_HOME: judgeHome, XDG_CONFIG_HOME: judgeHome,
        PATH: process.env.PATH ?? '' },
    },
  };
  const suite = {
    description: 'Saved source code quality, fixed rubric', prompts: ['Inspect the source files in the configured workspace.'],
    providers: [{ id: () => 'saved-source', callApi: async () => ({ output: 'Source files are in the configured read-only workspace.' }) }],
    tests: [{ description: 'Code quality', assert: [{ type: 'agent-rubric', value: codeRubric,
      provider, threshold: 0 }] }],
  };
  if (!evaluate) {
    process.env.PROMPTFOO_CONFIG_DIR = path.join(judgeHome, '.promptfoo');
    process.env.PROMPTFOO_DISABLE_TELEMETRY = '1';
    process.env.PROMPTFOO_DISABLE_UPDATE = '1';
    ({ evaluate } = await import('promptfoo'));
  }
  let summary;
  try {
    const record = await evaluate(suite, { cache: false, sharing: false, writeLatestResults: false, maxConcurrency: 1 });
    summary = await record.toEvaluateSummary();
  } finally {
    if (before !== await hashEvaluationSnapshot(workDir)) throw new Error('Judge changed evaluation source files');
  }
  const result = summary.results?.[0];
  const grade = result?.gradingResult;
  const component = grade?.componentResults?.[0] ?? grade;
  const rawScore = component?.score ?? grade?.score;
  const score = Number.isFinite(rawScore) ? Math.round(rawScore * 10000) / 100 : null;
  const reason = String(component?.reason ?? grade?.reason ?? result?.error ?? result?.failureReason ?? 'No grader result');
  let dimensions = score === null ? null : rubricEvidence(reason, score);
  if (dimensions) {
    for (const item of Object.values(dimensions)) {
      const file = path.resolve(workDir, item.file);
      if (!file.startsWith(`${workDir}${path.sep}`)) { dimensions = null; break; }
      const contents = await fs.readFile(file, 'utf8').catch(() => null);
      if (contents === null || item.line < 1 || item.line > contents.split('\n').length) { dimensions = null; break; }
    }
  }
  return { version: judgeConfig.rubricVersion, config: judgeConfig, sourceSha256: before,
    status: score !== null && score >= 0 && score <= 100 && dimensions ? 'evaluated' : 'error',
    score: score !== null && score >= 0 && score <= 100 && dimensions ? score : null,
    dimensions, reason, tokenUsage: grade?.tokensUsed ?? summary.stats?.tokenUsage?.assertions ?? null };
}
