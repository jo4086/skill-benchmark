import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const legacyEnvironmentsRoot = path.join(projectRoot, 'environments');

export function userDirectory(variable, ...fallback) {
  const override = process.env[variable];
  const root = override && path.isAbsolute(override) ? override : path.join(os.homedir(), ...fallback);
  return path.join(root, 'skill-benchmark');
}

export const environmentDataRoot = userDirectory('XDG_DATA_HOME', '.local', 'share');
export const environmentsRoot = path.join(environmentDataRoot, 'environments');
export const indexPath = path.join(environmentsRoot, 'index.json');

// flock operates on the inherited open file description until its owner closes it.
export function lockEnvironments(handle, exclusive) {
  const result = spawnSync('flock', [exclusive ? '-x' : '-s', '-n', '3'], {
    stdio: ['ignore', 'ignore', 'inherit', handle.fd],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Environment setup or benchmark in progress. Retry after it finishes.');
}

export function workspaceDefault(sources, index) {
  const pin = index?.workspaceDefault;
  if (pin?.repository !== sources.workspace.repository) return sources.workspace;
  if (!/^[0-9a-f]{40}$/.test(pin.commit)) throw new Error('Invalid workspace default commit');
  return { ...sources.workspace, commit: pin.commit };
}

export async function prepareEnvironmentDataRoot() {
  const project = await fs.realpath(projectRoot);
  const isInProject = (directory) => directory === project || directory.startsWith(`${project}${path.sep}`);
  if (isInProject(environmentDataRoot)) throw new Error('Environment data directory must be outside the project');
  await fs.mkdir(environmentDataRoot, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(environmentDataRoot);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)
    || isInProject(await fs.realpath(environmentDataRoot))) {
    throw new Error(`Expected a private environment data directory outside the project: ${environmentDataRoot}`);
  }
}

export async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function readJson(target) {
  return JSON.parse(await fs.readFile(target, 'utf8'));
}

export async function writeJsonAtomic(target, value) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, target);
  } finally {
    if (await exists(temporary)) await fs.unlink(temporary);
  }
}

export function validateSources(sources) {
  if (sources?.schemaVersion !== 1 || !isSource(sources.workspace) || !Array.isArray(sources.public)) {
    throw new Error('Invalid bootstrap/sources.json schema');
  }
  if (sources.workspace.id !== 'codex-workspace') throw new Error('Workspace id must be codex-workspace');
  const ids = new Set(['baseline', 'codex-workspace']);
  for (const source of sources.public) {
    if (!isSource(source) || ids.has(source.id)) {
      throw new Error(`Invalid or duplicate public source: ${source?.id}`);
    }
    ids.add(source.id);
  }
  return sources;
}

function isSource(value) {
  return value && /^[a-z0-9][a-z0-9-]*$/.test(value.id)
    && isSafeRepository(value.repository)
    && /^[0-9a-f]{40}$/.test(value.commit)
    && typeof value.skillsPath === 'string'
    && value.skillsPath.split('/').every((part) => /^[a-z0-9][a-z0-9-]*$/.test(part));
}

function isSafeRepository(repository) {
  if (typeof repository !== 'string') return false;
  try {
    const url = new URL(repository);
    return ['https:', 'file:'].includes(url.protocol) && !url.username && !url.password
      && !url.search && !url.hash;
  } catch {
    return path.isAbsolute(repository);
  }
}

export async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`${command} ${args[0] ?? ''} failed (${code}): ${stderr.trim() || stdout.trim()}`)));
  });
}

export async function fetchPinnedSource(source) {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-source-'));
  const gitEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_TERMINAL_PROMPT: '0',
  };
  try {
    await run('git', ['init', '-q', checkout], { env: gitEnv });
    await run('git', ['-C', checkout, 'remote', 'add', 'origin', source.repository], { env: gitEnv });
    await run('git', ['-C', checkout, 'fetch', '-q', '--depth', '1', 'origin', source.commit], { env: gitEnv });
    await run('git', ['-C', checkout, 'checkout', '-q', '--detach', 'FETCH_HEAD'], { env: gitEnv });
    const actual = await run('git', ['-C', checkout, 'rev-parse', 'HEAD'], { env: gitEnv });
    if (actual !== source.commit) throw new Error(`Commit mismatch for ${source.id}`);
    return checkout;
  } catch (error) {
    await fs.rm(checkout, { recursive: true, force: true });
    throw error;
  }
}

export async function assertNoSymlinks(target) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) throw new Error(`Source contains a symlink: ${target}`);
  if (stat.isDirectory()) {
    for (const name of await fs.readdir(target)) await assertNoSymlinks(path.join(target, name));
  } else if (!stat.isFile()) {
    throw new Error(`Unsupported source entry: ${target}`);
  }
}

export async function discoverSkills(root) {
  const found = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.name === 'SKILL.md' && entry.isFile())) {
      const name = path.basename(directory);
      const content = await fs.readFile(path.join(directory, 'SKILL.md'), 'utf8');
      if (!content.startsWith('---\n') || !/^name:\s*.+$/m.test(content) || !/^description:\s*.+$/m.test(content)) {
        throw new Error(`Invalid SKILL.md metadata: ${directory}`);
      }
      found.push({ name, directory });
      return;
    }
    for (const entry of entries) if (entry.isDirectory()) await visit(path.join(directory, entry.name));
  }
  await visit(root);
  const names = found.map(({ name }) => name);
  if (!found.length || new Set(names).size !== names.length) throw new Error(`Missing or duplicate skills in ${root}`);
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export async function copySkills(sourceRoot, targetRoot, { excludeNames = [] } = {}) {
  await assertNoSymlinks(sourceRoot);
  const skills = await discoverSkills(sourceRoot);
  const excluded = new Set(excludeNames);
  const missing = [...excluded].filter((name) => !skills.some((skill) => skill.name === name));
  if (missing.length) throw new Error(`Excluded Skill not found: ${missing.join(', ')}`);
  await fs.mkdir(targetRoot, { recursive: true });
  const included = skills.filter((skill) => !excluded.has(skill.name));
  for (const skill of included) await fs.cp(skill.directory, path.join(targetRoot, skill.name), { recursive: true, errorOnExist: true, force: false });
  return included.map(({ name }) => name);
}

export async function hashTree(root) {
  const hash = createHash('sha256');
  async function visit(directory, prefix = '') {
    for (const name of (await fs.readdir(directory)).sort()) {
      const full = path.join(directory, name);
      const relative = path.posix.join(prefix, name);
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) throw new Error(`Managed content contains a symlink: ${relative}`);
      if (stat.isDirectory()) {
        hash.update(`dir:${relative}\n`);
        await visit(full, relative);
      } else if (stat.isFile()) {
        hash.update(`file:${relative}\n`);
        hash.update(await fs.readFile(full));
      } else throw new Error(`Unsupported managed content: ${relative}`);
    }
  }
  await visit(root);
  return hash.digest('hex');
}

export function environmentPaths(id) {
  const home = `./environments/${id}`;
  return { home, codexHome: `${home}/.codex`, xdgConfigHome: `${home}/.config` };
}
