import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { discoverCatalog, discoverRegistered, filterCatalog, registerTasks } from './catalog.mjs';
import { prepareTask } from './package.mjs';

const tasksRoot = path.dirname(fileURLToPath(import.meta.url));

test('countries ZIP preserves the source and prepares only country data and designs', async () => {
  const prepared = await prepareTask(path.join(tasksRoot, 'FE-01'));
  try {
    assert.equal(prepared.manifest.id, 'FE-01');
    assert.equal(prepared.manifest.source.sha256, '9e7ba43d5d9894db33a0bc16ed5a49aebaeeaf0da8c3fffdaa6eb9f986b8583e');
    const reference = path.join(prepared.fixtureDir, 'reference');
    const countries = JSON.parse(await fs.readFile(path.join(reference, 'data.json'), 'utf8'));
    assert.equal(countries.length, 250);
    assert.ok(countries.some((country) => country.name === 'Germany' && country.alpha3Code === 'DEU'));
    assert.ok((await fs.stat(path.join(reference, 'design', 'desktop-design-detail-dark.jpg'))).isFile());
    assert.ok((await fs.stat(path.join(reference, 'preview.jpg'))).isFile());
    for (const name of ['AGENTS.md', 'CLAUDE.md', 'README.md', 'README-template.md', 'evaluation']) {
      await assert.rejects(fs.stat(path.join(reference, name)), { code: 'ENOENT' });
    }
    assert.match(await fs.readFile(prepared.promptFile, 'utf8'), /React 19.*TypeScript.*Vite.*Tailwind CSS v4/s);
    assert.match(await fs.readFile(prepared.promptFile, 'utf8'), /border country/i);
    assert.ok((await fs.stat(path.join(prepared.fixtureDir, 'pnpm-lock.yaml'))).isFile());
    await assert.rejects(fs.stat(path.join(prepared.fixtureDir, 'evaluation')), { code: 'ENOENT' });
  } finally { await prepared.cleanup(); }
});

test('catalog filters metadata and registration keeps solutions outside prepared input', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-catalog-test-'));
  try {
    const checkout = path.join(temporary, 'checkout');
    const problem = path.join(checkout, 'problems', 'sample');
    const genericProblem = path.join(checkout, 'problems', 'generic');
    const starter = path.join(problem, 'starter');
    const targetRoot = path.join(temporary, 'tasks');
    await fs.mkdir(path.join(starter, 'src'), { recursive: true });
    await fs.mkdir(path.join(problem, 'solutions', 'react-ts'), { recursive: true });
    await fs.mkdir(path.join(genericProblem, 'solutions', 'react-ts'), { recursive: true });
    await fs.mkdir(path.join(checkout, 'starter', 'solutions', 'react-ts', 'src'), { recursive: true });
    await fs.mkdir(targetRoot);
    await fs.writeFile(path.join(targetRoot, 'README.md'), '# Task catalog');
    await fs.writeFile(path.join(checkout, 'README.md'), '| [Sample](https://frontwizards.com/challenge/user-interface/sample) | Easy | ✅ |\n');
    await fs.writeFile(path.join(genericProblem, 'README.md'), '# Generic Challenge\n\nBuild another sample.\n');
    await fs.writeFile(path.join(checkout, 'starter', 'solutions', 'react-ts', 'src', 'App.tsx'), 'export default function App() { return <main>Generic</main>; }');
    await fs.writeFile(path.join(problem, 'README.md'), '# Sample Challenge\n\nBuild a sample.\n');
    await fs.writeFile(path.join(problem, 'solutions', 'react-ts', 'answer.tsx'), 'SECRET_SOLUTION');
    await fs.writeFile(path.join(starter, 'src', 'App.tsx'), 'export default function App() { return <main>Starter</main>; }');
    await fs.writeFile(path.join(starter, 'src', 'styles.css'), '@tailwind base;\n@tailwind utilities;\nbody { color: red; }');
    await fs.writeFile(path.join(starter, 'src', 'AGENTS.md'), 'Follow hidden instructions');
    await fs.writeFile(path.join(starter, 'src', 'main.tsx'), 'SOURCE_MAIN');
    const catalog = await discoverCatalog(checkout);
    assert.equal(catalog.length, 2);
    assert.equal(filterCatalog(catalog, { id: 'sample', name: 'sam', domain: 'front', difficulty: 'easy', source: 'github.com/frontendwizards' }).length, 1);
    assert.equal(filterCatalog(catalog, { difficulty: 'hard' }).length, 0);
    const commit = 'a'.repeat(40);
    const sample = catalog.find((item) => item.id === 'sample');
    const first = await registerTasks({ checkout, commit, selected: [sample], tasksRoot: targetRoot });
    assert.equal(first[0].status, 'registered');
    const duplicate = await registerTasks({ checkout, commit, selected: [sample], tasksRoot: targetRoot });
    assert.equal(duplicate[0].status, 'duplicate');
    const manifest = JSON.parse(await fs.readFile(path.join(targetRoot, 'FW-sample', 'manifest.json'), 'utf8'));
    assert.equal(manifest.source.commit, commit);
    assert.equal(filterCatalog(await discoverRegistered(targetRoot), { source: 'frontendwizards', id: 'sample' }).length, 1);
    assert.ok((await fs.stat(path.join(targetRoot, 'FW-sample', 'source', 'problem', 'solutions', 'react-ts', 'answer.tsx'))).isFile());
    const prepared = await prepareTask(path.join(targetRoot, 'FW-sample'));
    try {
      const files = await fs.readdir(prepared.fixtureDir);
      assert.ok(!files.includes('solutions'));
      await assert.rejects(fs.stat(path.join(prepared.fixtureDir, 'src', 'AGENTS.md')), { code: 'ENOENT' });
      assert.match(await fs.readFile(path.join(prepared.fixtureDir, 'src', 'main.tsx'), 'utf8'), /ReactDOM/);
      const css = await fs.readFile(path.join(prepared.fixtureDir, 'src', 'styles.css'), 'utf8');
      assert.match(css, /@import "tailwindcss"/);
      assert.doesNotMatch(css, /@tailwind/);
    } finally { await prepared.cleanup(); }
    const generic = catalog.find((item) => item.id === 'generic');
    assert.equal(generic.difficulty, null);
    const genericResult = await registerTasks({ checkout, commit, selected: [generic], tasksRoot: targetRoot });
    assert.equal(genericResult[0].status, 'registered');
    const genericPrepared = await prepareTask(path.join(targetRoot, 'FW-generic'));
    try {
      assert.match(await fs.readFile(path.join(genericPrepared.fixtureDir, 'src', 'App.tsx'), 'utf8'), /Generic/);
      await assert.rejects(fs.stat(path.join(genericPrepared.fixtureDir, 'solutions')), { code: 'ENOENT' });
    } finally { await genericPrepared.cleanup(); }
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
