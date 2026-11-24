import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { evaluateStatic } from './static.mjs';

test('static evaluation records type and lint failures separately', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-static-test-'));
  await fs.writeFile(path.join(root, 'bad.ts'), 'const value: any = 1;\nexport default value;');
  try {
    const result = await evaluateStatic(root, root);
    assert.equal(result.typescript.pass, false);
    assert.equal(result.eslint.pass, false);
    assert.equal(result.score, 0);
    assert.ok(result.eslint.diagnostics.some((item) => item.rule === '@typescript-eslint/no-explicit-any'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
