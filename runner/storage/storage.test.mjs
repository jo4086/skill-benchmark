import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readJson, run } from '../../bootstrap/environment/common.mjs';
import { executePlan } from '../index.mjs';
import { readResultRuns } from './result.mjs';
import { createRunDirectories, restoreSnapshot } from './storage.mjs';

test('allocates run numbers and stores a comparison with restorable worktrees', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-storage-test-'));
  const before = { TMPDIR: process.env.TMPDIR, XDG_STATE_HOME: process.env.XDG_STATE_HOME, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME, PATH: process.env.PATH,
    PROMPTFOO_CONFIG_DIR: process.env.PROMPTFOO_CONFIG_DIR, PROMPTFOO_DISABLE_TELEMETRY: process.env.PROMPTFOO_DISABLE_TELEMETRY,
    PROMPTFOO_DISABLE_UPDATE: process.env.PROMPTFOO_DISABLE_UPDATE };
  t.after(async () => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  process.env.TMPDIR = path.join(root, 'tmp');
  process.env.XDG_STATE_HOME = path.join(root, 'state');
  process.env.XDG_CACHE_HOME = path.join(root, 'cache');
  const stateDir = path.join(process.env.XDG_STATE_HOME, 'skill-benchmark');
  const workRoot = path.join(process.env.TMPDIR, 'skill-benchmark');
  const reservations = await Promise.all([
    createRunDirectories('FE-01'), createRunDirectories('FE-01'), createRunDirectories('FE-02'),
  ]);
  assert.deepEqual(reservations.map((item) => item.name).sort(), ['run-01', 'run-01', 'run-02']);
  assert.deepEqual(await readJson(path.join(stateDir, 'state.json')), { runs: { 'FE-01': 2, 'FE-02': 1 } });

  const bin = path.join(root, 'bin');
  const fixtureDir = path.join(root, 'fixture');
  await Promise.all([fs.mkdir(bin), fs.mkdir(fixtureDir)]);
  const codex = path.join(bin, 'codex');
  await fs.writeFile(codex, `#!/bin/sh
cat >/dev/null
mkdir src node_modules
printf '%s\\n' 'export const value = 42;' > src/app.mjs
printf '%s\\n' 'import assert from "node:assert/strict"; import { value } from "./src/app.mjs"; assert.equal(value, 42);' > app.test.mjs
printf '%s\\n' '# Generated project' > README.md
printf '%s\\n' '# Project instructions' > AGENTS.md
printf '%s\\n' '{"scripts":{"test":"node --test app.test.mjs"}}' > package.json
printf '%s\\n' "lockfileVersion: '9.0'" 'importers:' '  .: {}' > pnpm-lock.yaml
touch .env.local auth.json node_modules/ignored
printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":2,"cached_input_tokens":1}}'
`, { mode: 0o700 });
  process.env.PATH = `${bin}${path.delimiter}${before.PATH}`;

  const plan = await Promise.all(['baseline', 'codex-workspace'].map(async (id) => {
    const home = path.join(root, id);
    const codexHome = path.join(home, '.codex');
    await fs.mkdir(codexHome, { recursive: true });
    if (id === 'codex-workspace') await fs.writeFile(path.join(codexHome, 'AGENTS.md'), '# Environment instructions\n');
    const manifest = {
      schemaVersion: 1, id, source: id === 'codex-workspace'
        ? { kind: 'git', repository: 'https://example.invalid/codex-workspace.git', commit: 'a'.repeat(40), skillsPath: 'skills' }
        : { kind: 'baseline' },
      sourceCommit: id === 'codex-workspace' ? 'a'.repeat(40) : null,
      sourceDirty: false,
      skillNames: id === 'codex-workspace' ? ['skill-router'] : [],
      commonSkillNames: [], excludedSkillNames: id === 'codex-workspace' ? ['code-style'] : [],
      contentHash: `${id}-content`, codexVersion: 'mock-version', installedAt: '2026-01-01T00:00:00.000Z',
    };
    return { repetition: 1, environment: { id, home, codexHome, xdgConfigHome: path.join(home, '.config'),
      source: manifest.source, contentHash: manifest.contentHash, manifest } };
  }));
  const prompt = 'Create a fixture.';
  const promptFile = path.join(root, 'prompt.md');
  await fs.writeFile(promptFile, prompt);
  const inputs = { fixtureDir, prompt, promptFile, inputHash: createHash('sha256').update(prompt).digest('hex') };
  const options = { taskId: 'smoke', environments: plan.map(({ environment }) => environment.id), repeats: 1,
    timeoutSeconds: 10, model: 'mock-model', browser: { browsersPath: root } };
  await executePlan(options, inputs, null, plan, 'mock-version');

  const outputDir = path.join(stateDir, 'results', 'smoke', 'run-01');
  const resultFile = path.join(outputDir, 'result.json');
  const result = await readJson(resultFile);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.runs.map((entry) => entry.workDir), ['baseline', 'codex-workspace'].map((id) =>
    path.join(workRoot, 'smoke-run-01', id)));
  assert.deepEqual(result.snapshots.map((entry) => entry.file),
    ['snapshots/baseline.zip', 'snapshots/codex-workspace.zip']);
  assert.equal(result.snapshots[1].sourceCommit, 'a'.repeat(40));
  assert.deepEqual(result.snapshots[1].excludedSkillNames, ['code-style']);
  assert.deepEqual(result.comparisons, ['comparisons/final/comparison.json']);
  assert.ok((await fs.stat(path.join(root, 'cache/skill-benchmark/promptfoo'))).isDirectory());
  assert.match(await fs.readFile(path.join(outputDir, 'comparisons/final/summary.md'), 'utf8'),
    /\.\.\/\.\.\/attempts\/baseline\/attempt-01\/run\.json/);
  assert.match(await fs.readFile(path.join(outputDir, 'user-checklist.md'), 'utf8'), /restore -- smoke run-01 baseline/);
  const { runs } = await readResultRuns(resultFile);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].usage.outputTokens, 2);

  const archive = path.join(outputDir, result.snapshots[1].file);
  assert.equal(await run('unzip', ['-p', archive, 'environment/AGENTS.md']), '# Environment instructions');
  const archivedManifest = JSON.parse(await run('unzip', ['-p', archive, 'environment/manifest.json']));
  assert.equal(archivedManifest.sourceCommit, 'a'.repeat(40));
  assert.deepEqual(archivedManifest.skillNames, ['skill-router']);
  assert.deepEqual(archivedManifest.excludedSkillNames, ['code-style']);
  const runRecord = await readJson(path.join(outputDir, result.runs.find((entry) => entry.environmentId === 'codex-workspace').record));
  assert.deepEqual(runRecord.environmentManifest, archivedManifest);
  await fs.rm(result.workDir, { recursive: true });
  await run('pnpm', ['run', 'compare', '--', '--result', resultFile]);
  assert.ok((await fs.readdir(path.join(outputDir, 'comparisons', 'rechecks'))).includes('INDEX.md'));
  const restored = await restoreSnapshot('smoke', 'run-01', 'codex-workspace');
  assert.equal(await fs.readFile(path.join(restored, 'README.md'), 'utf8'), '# Generated project\n');
  assert.equal(await fs.readFile(path.join(restored, 'AGENTS.md'), 'utf8'), '# Project instructions\n');
  await Promise.all(['.env.local', 'auth.json', 'node_modules'].map((file) =>
    assert.rejects(fs.stat(path.join(restored, file)), { code: 'ENOENT' })));
  await run('pnpm', ['install', '--frozen-lockfile', '--offline'], { cwd: restored });
  await run('pnpm', ['test'], { cwd: restored });
  await fs.appendFile(archive, 'modified');
  await assert.rejects(restoreSnapshot('smoke', 'run-01', 'codex-workspace'), /Snapshot hash mismatch/);
});
