#!/usr/bin/env node
import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { environmentsRoot, exists, indexPath, readJson } from '../environment/common.mjs';

export function userAuthPath() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.resolve(codexHome, 'auth.json');
}

export async function hasUserAuth() {
  try {
    const stat = await fs.lstat(userAuthPath());
    return stat.isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function copyUserAuth() {
  const sourcePath = userAuthPath();
  if (isWithin(environmentsRoot, sourcePath)) throw new Error('Codex auth source is inside environments/');
  let source;
  try {
    source = await fs.open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('No file-based Codex login found; sign in first or use an existing auth.json');
    throw error;
  }
  let content;
  try {
    const sourceStat = await source.stat();
    if (!sourceStat.isFile()) throw new Error('Codex auth source is not a regular file');
    if (process.getuid && sourceStat.uid !== process.getuid()) throw new Error('Codex auth source is not owned by the current user');
    if ((await fs.lstat(environmentsRoot)).isSymbolicLink()) throw new Error('Environments directory is a symlink');
    if ((await fs.lstat(indexPath)).isSymbolicLink()) throw new Error('Environment index is a symlink');
    const index = await readJson(indexPath);
    if (index.schemaVersion !== 1 || !Array.isArray(index.environments)) throw new Error('Invalid Bootstrap environment index');
    content = await source.readFile();
    const targets = [];
    for (const entry of index.environments) {
      const id = entry.id;
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('Invalid environment id in index');
      const root = path.join(environmentsRoot, id);
      const codexHome = path.join(root, '.codex');
      if ((await fs.lstat(root)).isSymbolicLink() || !(await fs.lstat(codexHome)).isDirectory()
        || (await fs.lstat(codexHome)).isSymbolicLink()) {
        throw new Error(`Unsafe Codex home for ${id}`);
      }
      const manifestPath = path.join(root, 'environment.json');
      if ((await fs.lstat(manifestPath)).isSymbolicLink()) throw new Error(`Environment manifest is a symlink: ${id}`);
      const manifest = await readJson(manifestPath);
      if (manifest.schemaVersion !== 1 || manifest.id !== id) throw new Error(`Unmanaged environment: ${id}`);
      const destination = path.join(codexHome, 'auth.json');
      if (await exists(destination)) {
        if ((await fs.lstat(destination)).isSymbolicLink()) throw new Error(`Auth destination is a symlink: ${id}`);
        if (!(await fs.lstat(destination)).isFile()) throw new Error(`Auth destination is not a file: ${id}`);
        targets.push({ id, codexHome, destination, preserve: true });
      } else {
        targets.push({ id, codexHome, destination, preserve: false });
      }
    }
    const copied = [];
    const preserved = [];
    for (const targetInfo of targets) {
      const { id, codexHome, destination, preserve } = targetInfo;
      if (preserve) {
        preserved.push(id);
        continue;
      }
      await fs.chmod(codexHome, 0o700);
      const target = await fs.open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await target.writeFile(content);
      } catch (error) {
        await target.close();
        await fs.unlink(destination);
        throw error;
      }
      await target.close();
      copied.push(id);
    }
    return { copied, preserved };
  } finally {
    content?.fill(0);
    await source.close();
  }
}

async function main() {
  if (process.argv.length !== 2) throw new Error('Usage: pnpm run auth:copy');
  const { copied, preserved } = await copyUserAuth();
  console.log(`Copied Codex login to ${copied.length} environment(s); preserved existing login in ${preserved.length}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Auth copy failed: ${error.message}`); process.exitCode = 1; });
}
