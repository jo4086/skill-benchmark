import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoSymlinks, hashTree, readJson, run } from '../../bootstrap/environment/common.mjs';

const tasksRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendRoot = path.join(tasksRoot, 'shared', 'frontend');
const templateRoot = path.join(frontendRoot, 'template');
const excludedNames = new Set(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'README.md', 'README-template.md', 'node_modules', 'solutions', 'evaluation', '__tests__', 'reportAccessibility.ts']);

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\')
    && !['*', '?', '[', ']'].some((character) => value.includes(character))
    && value.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\x00-\x1f]/.test(part));
}

function isInstructionFile(relative) {
  return relative.split('/').some((part) => excludedNames.has(part)) || /(?:^|\/)\S+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative);
}

async function copyTree(source, destination, prefix = '') {
  await assertNoSymlinks(source);
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (isInstructionFile(relative) || relative === 'src/main.tsx') continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to, relative);
    else if (entry.isFile()) await fs.copyFile(from, to);
    else throw new Error(`Unsupported starter entry: ${relative}`);
  }
}

async function extractFile(archive, entry, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const file = await fs.open(destination, 'wx', 0o600);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('unzip', ['-p', archive, entry], { stdio: ['ignore', file.fd, 'pipe'] });
      let stderr = '';
      child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Could not extract ${entry}: ${stderr.trim()}`)));
    });
  } finally {
    await file.close();
  }
}

async function prepareZip(manifest, taskDir, fixtureDir) {
  const { archive, root, sha256 } = manifest.source;
  if (!safeRelative(archive) || !safeRelative(root) || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Invalid ZIP source');
  const archiveFile = path.join(taskDir, archive);
  if (!(await fs.lstat(archiveFile)).isFile()) throw new Error('ZIP source is missing');
  const actual = createHash('sha256').update(await fs.readFile(archiveFile)).digest('hex');
  if (actual !== sha256) throw new Error('ZIP source hash differs from manifest');
  const entries = (await run('unzip', ['-Z', '-1', archiveFile])).split('\n');
  if (entries.some((entry) => !safeRelative(entry.replace(/\/$/, '')))) throw new Error('ZIP has an unsafe path');
  if (new Set(entries).size !== entries.length) throw new Error('ZIP has duplicate paths');
  const files = manifest.input?.files ?? [];
  const directories = manifest.input?.directories ?? [];
  if (!Array.isArray(files) || !Array.isArray(directories) || !files.length && !directories.length
    || new Set(files).size !== files.length || new Set(directories).size !== directories.length) {
    throw new Error('Invalid ZIP input selection');
  }
  const selected = new Set(files);
  for (const directory of directories) {
    if (!safeRelative(directory) || isInstructionFile(directory)) throw new Error(`Excluded or unsafe ZIP directory: ${directory}`);
    const prefix = `${root}/${directory}/`;
    const matches = entries.filter((entry) => entry.startsWith(prefix) && !entry.endsWith('/'));
    if (!matches.length) throw new Error(`ZIP directory is missing or empty: ${directory}`);
    for (const entry of matches) {
      const relative = entry.slice(root.length + 1);
      if (!isInstructionFile(relative)) selected.add(relative);
    }
  }
  for (const relative of [...selected].sort()) {
    if (!safeRelative(relative) || isInstructionFile(relative)) throw new Error(`Excluded or unsafe ZIP input: ${relative}`);
    const entry = `${root}/${relative}`;
    if (!entries.includes(entry) || entry.endsWith('/')) throw new Error(`ZIP input is missing: ${relative}`);
    await extractFile(archiveFile, entry, path.join(fixtureDir, 'reference', relative));
  }
}

async function prepareStarter(manifest, taskDir, fixtureDir) {
  const relative = manifest.input?.path;
  if (!safeRelative(relative) || !relative.startsWith('source/')) throw new Error('Invalid starter path');
  if (manifest.source?.repository !== 'https://github.com/frontendwizards/frontend-challenges.git'
    || !/^[0-9a-f]{40}$/.test(manifest.source.commit)
    || !/^problems\/[A-Za-z0-9-]+$/.test(manifest.source.problemPath)
    || !['source/problem/starter', 'source/generic-starter'].includes(relative)
    || relative !== (manifest.source.starterPath === `${manifest.source.problemPath}/starter` ? 'source/problem/starter' : 'source/generic-starter')) {
    throw new Error('Invalid Git starter source');
  }
  const starter = path.join(taskDir, relative);
  if (manifest.source?.contentHash !== await hashTree(path.join(taskDir, 'source'))) throw new Error('Preserved Git source changed');
  if (!(await fs.lstat(starter)).isDirectory()) throw new Error('Starter directory is missing');
  for (const name of ['src', 'public']) {
    const source = path.join(starter, name);
    try {
      if ((await fs.lstat(source)).isDirectory()) await copyTree(source, path.join(fixtureDir, name), name);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const styles = path.join(fixtureDir, 'src', 'styles.css');
  const css = await fs.readFile(styles, 'utf8');
  const migrated = css.replace(/@tailwind (?:base|components|utilities);?\s*/g, '').replace(/@import ["']tailwindcss["'];?\s*/g, '');
  await fs.writeFile(styles, `@import "tailwindcss";\n${migrated}`);
}

export async function prepareTask(taskDir) {
  const absolute = path.resolve(taskDir);
  const manifestFile = path.join(absolute, 'manifest.json');
  const manifest = await readJson(manifestFile);
  const manifestHash = createHash('sha256').update(await fs.readFile(manifestFile)).digest('hex');
  if (manifest.schemaVersion !== 1 || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(manifest.id)
    || path.basename(absolute) !== manifest.id || manifest.techSpec !== 'frontend'
    || manifest.prompt !== 'task.md' || manifest.input?.kind !== (manifest.source?.kind === 'zip' ? 'zip-files' : 'starter')) {
    throw new Error('Invalid task manifest');
  }
  const promptPath = path.join(absolute, manifest.prompt);
  await assertNoSymlinks(promptPath);
  const originalPrompt = await fs.readFile(promptPath, 'utf8');
  if (!originalPrompt.trim()) throw new Error('Task prompt is empty');
  const prepared = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-task-'));
  try {
    const fixtureDir = path.join(prepared, 'fixture');
    await fs.cp(templateRoot, fixtureDir, { recursive: true,
      filter: (source) => !source.split(path.sep).some((part) => ['node_modules', 'dist', '.pnpm', '.tsbuildinfo'].includes(part)) });
    if (manifest.source.kind === 'zip') await prepareZip(manifest, absolute, fixtureDir);
    else if (manifest.source.kind === 'git') await prepareStarter(manifest, absolute, fixtureDir);
    else throw new Error('Unsupported task source');
    const techSpec = await fs.readFile(path.join(frontendRoot, 'technical-spec.md'), 'utf8');
    const promptFile = path.join(prepared, 'prompt.md');
    await fs.writeFile(promptFile, `${originalPrompt.trim()}\n\n${techSpec.trim()}\n`);
    return { manifest, manifestHash, fixtureDir, promptFile, originalPromptFile: promptPath, taskDir: absolute, cleanup: () => fs.rm(prepared, { recursive: true, force: true }) };
  } catch (error) {
    await fs.rm(prepared, { recursive: true, force: true });
    throw error;
  }
}
