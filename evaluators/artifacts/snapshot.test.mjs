import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { copyEvaluationSnapshot, hashEvaluationSnapshot } from './snapshot.mjs';

test('snapshot preserves source but excludes instructions, secrets, build output and reference', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-snapshot-test-'));
  const source = path.join(root, 'source');
  const artifact = path.join(root, 'artifact');
  await fs.mkdir(path.join(source, 'src'), { recursive: true });
  await fs.mkdir(path.join(source, 'reference'));
  await fs.writeFile(path.join(source, 'src', 'App.tsx'), 'export default 1;');
  await fs.writeFile(path.join(source, 'AGENTS.md'), 'secret instruction');
  await fs.writeFile(path.join(source, 'SKILL.md'), 'agent skill');
  await fs.writeFile(path.join(source, '.env'), 'secret');
  await fs.writeFile(path.join(source, 'reference', 'solution.ts'), 'solution');
  try {
    const hash = await copyEvaluationSnapshot(source, artifact);
    assert.equal(hash, await hashEvaluationSnapshot(artifact));
    assert.equal(await fs.readFile(path.join(artifact, 'src', 'App.tsx'), 'utf8'), 'export default 1;');
  for (const file of ['AGENTS.md', 'SKILL.md', '.env', 'reference/solution.ts']) assert.equal(await fs.stat(path.join(artifact, file)).then(() => true, () => false), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
