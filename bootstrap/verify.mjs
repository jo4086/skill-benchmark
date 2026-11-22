#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  environmentPaths, environmentsRoot, exists, hashTree, indexPath, projectRoot,
  readJson, run, validateSources,
} from './common.mjs';

function verifySource(id, source, sources) {
  if (id === 'baseline') {
    if (source?.kind !== 'baseline') throw new Error('baseline: invalid source');
    return;
  }
  const expected = id === 'codex-workspace'
    ? sources.workspace
    : sources.public.find((candidate) => candidate.id === id);
  if (!expected) throw new Error(`${id}: source is no longer configured`);
  if (source?.kind === 'local' && id === 'codex-workspace') return;
  if (source?.kind !== 'git' || source.repository !== expected.repository
    || source.commit !== expected.commit || source.skillsPath !== expected.skillsPath) {
    throw new Error(`${id}: installed Git source differs from sources.json`);
  }
}

async function verifyEnvironment(entry, sources, codexVersion) {
  const id = entry?.id;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('Invalid environment id in index');
  const expectedPaths = environmentPaths(id);
  for (const [key, expected] of Object.entries(expectedPaths)) {
    if (entry[key] !== expected) throw new Error(`${id}: invalid ${key} path`);
  }
  if (entry.manifest !== `./environments/${id}/environment.json`) throw new Error(`${id}: invalid manifest path`);
  const root = path.join(environmentsRoot, id);
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error(`${id}: environment is a symlink`);
  const manifestFile = path.join(root, 'environment.json');
  if ((await fs.lstat(manifestFile)).isSymbolicLink()) throw new Error(`${id}: manifest is a symlink`);
  const manifest = await readJson(manifestFile);
  if (manifest.schemaVersion !== 1 || manifest.id !== id || JSON.stringify(manifest.paths) !== JSON.stringify(expectedPaths)
    || JSON.stringify(manifest.source) !== JSON.stringify(entry.source)) {
    throw new Error(`${id}: manifest/index mismatch`);
  }
  verifySource(id, manifest.source, sources);
  if (manifest.codexVersion !== codexVersion) throw new Error(`${id}: Codex version differs from environment index`);
  for (const subpath of ['.agents/skills', '.codex', '.config']) {
    if (!(await fs.stat(path.join(root, subpath))).isDirectory()) throw new Error(`${id}: missing ${subpath}`);
  }
  const names = (await fs.readdir(path.join(root, '.agents', 'skills'))).sort();
  if (JSON.stringify(names) !== JSON.stringify([...manifest.skillNames].sort())) throw new Error(`${id}: skill inventory mismatch`);
  for (const name of names) {
    if (!(await exists(path.join(root, '.agents', 'skills', name, 'SKILL.md')))) throw new Error(`${id}: missing SKILL.md for ${name}`);
  }
  if (await hashTree(path.join(root, '.agents')) !== manifest.contentHash) throw new Error(`${id}: managed content changed`);
  if (id === 'baseline' && (JSON.stringify(names) !== JSON.stringify([...manifest.commonSkillNames].sort())
    || await exists(path.join(root, '.agents', 'AGENTS.md')) || await exists(path.join(root, '.agents', 'hooks.json')))) {
    throw new Error('baseline: custom instructions, hooks, or skills found');
  }
  if (id === 'codex-workspace') {
    for (const subpath of ['.agents/AGENTS.md', '.agents/hooks.json', '.agents/hooks/git']) {
      if (!(await exists(path.join(root, subpath)))) throw new Error(`codex-workspace: missing ${subpath}`);
    }
    if (await fs.readlink(path.join(root, '.codex', 'AGENTS.md')) !== '../.agents/AGENTS.md') {
      throw new Error('codex-workspace: invalid Codex AGENTS.md link');
    }
  }
  return { id, skillCount: names.length, source: manifest.source };
}

async function main() {
  if (process.argv.length !== 2) throw new Error('Usage: pnpm verify');
  if ((await fs.lstat(indexPath)).isSymbolicLink()) throw new Error('Environment index is a symlink');
  const index = await readJson(indexPath);
  if (index.schemaVersion !== 1 || !Array.isArray(index.environments)) throw new Error('Invalid environment index');
  const sources = validateSources(await readJson(path.join(projectRoot, 'bootstrap', 'sources.json')));
  const currentCodexVersion = await run('codex', ['--version']);
  if (currentCodexVersion !== index.codexVersion) throw new Error(`Codex version changed: installed ${index.codexVersion}, current ${currentCodexVersion}`);
  const ids = index.environments.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length || !ids.includes('baseline') || !ids.includes('codex-workspace')) {
    throw new Error('Environment index must contain unique ids, baseline, and codex-workspace');
  }
  let failures = 0;
  for (const entry of index.environments) {
    try {
      const result = await verifyEnvironment(entry, sources, index.codexVersion);
      console.log(`OK ${result.id}: ${result.skillCount} skills (${result.source.kind})`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${entry?.id ?? '<unknown>'}: ${error.message}`);
    }
  }
  if (failures) throw new Error(`${failures} environment(s) failed verification`);
  console.log('All indexed environments verified. Authentication and runtime Skill use are not checked.');
}

main().catch((error) => { console.error(`Verification failed: ${error.message}`); process.exitCode = 1; });
