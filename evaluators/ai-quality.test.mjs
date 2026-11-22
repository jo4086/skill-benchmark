import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { evaluateAiCodeQuality, judgeConfig } from './ai-quality.mjs';

test('agent-rubric receives isolated read-only source and records scoring evidence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-ai-test-'));
  const workDir = path.join(root, 'code');
  const judgeHome = path.join(root, 'judge');
  await fs.mkdir(workDir);
  await fs.mkdir(judgeHome);
  await fs.writeFile(path.join(workDir, 'App.tsx'), 'export const App = () => <main />;');
  try {
    const result = await evaluateAiCodeQuality(workDir, { judgeHome, evaluate: async (suite) => {
      const assertion = suite.tests[0].assert[0];
      assert.equal(assertion.type, 'agent-rubric');
      assert.equal(assertion.provider.config.working_dir, workDir);
      assert.equal(assertion.provider.config.sandbox_mode, 'read-only');
      assert.equal(assertion.provider.config.model, judgeConfig.model);
      assert.equal(assertion.provider.config.inherit_process_env, false);
      assert.equal(await fs.readFile(path.join(workDir, 'App.tsx'), 'utf8'), 'export const App = () => <main />;');
      return { toEvaluateSummary: async () => ({ results: [{ gradingResult: {
        score: 0.84, reason: 'All assertions passed',
        componentResults: [{ score: 0.84, reason: 'structure: 20/25 at App.tsx:1 — clear component\nreadability: 17/20 at App.tsx:1 — short names\nmaintainability: 22/25 at App.tsx:1 — simple change\ncomplexity: 12/15 at App.tsx:1 — no layers\nresponsibility: 13/15 at App.tsx:1 — single view' }],
        tokensUsed: { prompt: 100, completion: 20, total: 120 },
      } }] }) };
    } });
    assert.equal(result.status, 'evaluated');
    assert.equal(result.score, 84);
    assert.equal(result.dimensions.structure.points, 20);
    assert.equal(result.tokenUsage.total, 120);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('judge source mutation invalidates the evaluation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-ai-mutation-'));
  const workDir = path.join(root, 'code');
  const judgeHome = path.join(root, 'judge');
  await fs.mkdir(workDir);
  await fs.mkdir(judgeHome);
  await fs.writeFile(path.join(workDir, 'App.tsx'), 'export default 1;');
  try {
    await assert.rejects(evaluateAiCodeQuality(workDir, { judgeHome, evaluate: async () => {
      await fs.writeFile(path.join(workDir, 'App.tsx'), 'export default 2;');
      return { toEvaluateSummary: async () => ({ results: [] }) };
    } }), /changed evaluation source/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
