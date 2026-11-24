import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, projectRoot, readJson, run, userDirectory, writeJsonAtomic } from '../../bootstrap/environment/common.mjs';

const script = fileURLToPath(import.meta.url);
const excluded = new Set([
  'node_modules', '.git', '.codex', '.agents', '.claude', '.npm', '.cache', '.vite',
  '.pnpm-store', 'dist', 'build', 'coverage', 'playwright-report', 'test-results',
  '.promptfoo', 'auth.json', '.npmrc', '.netrc', 'credentials.json', 'self-validation.log',
]);

export function safeSegment(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value)) {
    throw new Error('Invalid path identifier');
  }
  return value;
}

export function stateDirectory() {
  return userDirectory('XDG_STATE_HOME', '.local', 'state');
}

export function taskResultsDirectory(taskId) {
  return path.join(stateDirectory(), 'results', safeSegment(taskId));
}

export async function assertSafeWorkPath(workDir) {
  const real = await fs.realpath(workDir);
  const repo = await fs.realpath(projectRoot);
  if (real === repo || real.startsWith(`${repo}${path.sep}`)) throw new Error('Working directory is inside the project');
  for (let current = real; ; current = path.dirname(current)) {
    for (const name of ['AGENTS.md', 'AGENTS.override.md']) {
      if (await exists(path.join(current, name))) throw new Error(`Parent instructions found: ${path.join(current, name)}`);
    }
    if (current === path.dirname(current)) break;
  }
}

async function workRoot() {
  const root = path.join(os.tmpdir(), 'skill-benchmark');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
    throw new Error(`Expected a private benchmark work directory: ${root}`);
  }
  await assertSafeWorkPath(root);
  return root;
}

export async function temporaryWorkDirectory(prefix) {
  return fs.mkdtemp(path.join(await workRoot(), `${safeSegment(prefix)}-`));
}

async function reserveResult(taskId) {
  const root = await workRoot();
  const file = path.join(stateDirectory(), 'state.json');
  const state = await exists(file) ? await readJson(file) : { runs: {} };
  if (typeof state?.runs !== 'object' || state.runs === null || Array.isArray(state.runs)) {
    throw new Error('Invalid state.json runs');
  }
  const previous = Object.hasOwn(state.runs, taskId) ? state.runs[taskId] : 0;
  if (!Number.isSafeInteger(previous) || previous < 0) throw new Error('Invalid state.json run number');
  const taskDir = taskResultsDirectory(taskId);
  await fs.mkdir(taskDir, { recursive: true, mode: 0o700 });
  const folders = await fs.readdir(taskDir);
  const lastNumber = folders.reduce((number, name) => {
    const match = /^run-(\d+)$/.exec(name);
    return match ? Math.max(number, Number(match[1])) : number;
  }, previous);
  for (let number = lastNumber + 1; Number.isSafeInteger(number); number += 1) {
    const name = `run-${String(number).padStart(2, '0')}`;
    const workDir = path.join(root, `${taskId}-${name}`);
    try {
      await fs.mkdir(workDir, { mode: 0o700 });
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      throw error;
    }
    await fs.mkdir(path.join(taskDir, name), { mode: 0o700 });
    state.runs[taskId] = number;
    await writeJsonAtomic(file, state);
    return name;
  }
  throw new Error('Run number exhausted');
}

export async function createRunDirectories(taskId) {
  const root = await workRoot();
  const state = stateDirectory();
  await fs.mkdir(state, { recursive: true, mode: 0o700 });
  const name = await run('flock', ['-w', '15', path.join(state, '.state.lock'), process.execPath, script, 'reserve', safeSegment(taskId)]);
  return { name, outputDir: path.join(taskResultsDirectory(taskId), name), workDir: path.join(root, `${taskId}-${name}`) };
}

async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function captureInstructions(environment) {
  const instructions = {};
  for (const name of ['AGENTS.override.md', 'AGENTS.md']) {
    const source = path.join(environment.codexHome, name);
    if (await exists(source)) instructions[name] = await fs.readFile(source);
  }
  return instructions;
}

export async function archiveWorktree(workDir, destination, instructions, environmentManifest = null) {
  if (!(await fs.lstat(workDir)).isDirectory()) throw new Error('Snapshot source must be a directory');
  const directory = path.dirname(destination);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stage = await fs.mkdtemp(path.join(directory, '.snapshot-'));
  try {
    await fs.cp(workDir, path.join(stage, 'project'), {
      recursive: true,
      filter: async (source) => {
        if (source === workDir) return true;
        const name = path.basename(source);
        if (excluded.has(name) || (name.startsWith('.env') && name !== '.env.example') || name.endsWith('.tsbuildinfo')) return false;
        const entry = await fs.lstat(source);
        if (entry.isDirectory() || entry.isFile()) return true;
        throw new Error(`Unsupported snapshot entry: ${path.relative(workDir, source)}`);
      },
    });
    const names = Object.keys(instructions);
    if (names.length || environmentManifest) {
      const metadata = path.join(stage, 'environment');
      await fs.mkdir(metadata, { mode: 0o700 });
      for (const name of names) await fs.writeFile(path.join(metadata, name), instructions[name], { mode: 0o600 });
      if (environmentManifest) {
        await fs.writeFile(path.join(metadata, 'manifest.json'), `${JSON.stringify(environmentManifest, null, 2)}\n`, { mode: 0o600 });
      }
    }
    const temporary = path.join(stage, 'snapshot.zip');
    const contents = names.length || environmentManifest ? ['project', 'environment'] : ['project'];
    await run('zip', ['-q', '-r', temporary, ...contents], { cwd: stage, env: { ...process.env, ZIPOPT: '' } });
    const sha256 = await fileHash(temporary);
    await fs.chmod(temporary, 0o600);
    await fs.link(temporary, destination);
    return sha256;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

export async function restoreSnapshot(taskId, name, environment, repetition = 1) {
  if (!/^run-\d{2,}$/.test(name) || !Number.isSafeInteger(repetition) || repetition < 1) throw new Error('Invalid run or repetition');
  const directory = path.join(taskResultsDirectory(taskId), name);
  const result = await readJson(path.join(directory, 'result.json'));
  const snapshot = result.snapshots.find((item) => item.environmentId === environment && item.repetition === repetition);
  if (!snapshot?.file) throw new Error(`Snapshot unavailable for ${environment}, repeat ${repetition}`);
  const archive = path.join(directory, 'snapshots', path.basename(snapshot.file));
  if (snapshot.sha256 !== await fileHash(archive)) throw new Error('Snapshot hash mismatch');
  const stage = await fs.mkdtemp(path.join(await workRoot(), `restore-${safeSegment(taskId)}-${name}-${safeSegment(environment)}-`));
  try {
    await run('unzip', ['-q', archive, 'project/*', '-d', stage], { env: { ...process.env, UNZIP: '', UNZIPOPT: '' } });
    return path.join(stage, 'project');
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const [command, ...args] = process.argv.slice(2).filter((arg) => arg !== '--');
  const usage = 'Usage: pnpm run restore -- TASK run-NN ENVIRONMENT [REPETITION]';
  const main = async () => {
    if (command === 'reserve' && args.length === 1) return reserveResult(safeSegment(args[0]));
    if (command === 'manual' && args.length === 1) {
      return temporaryWorkDirectory(`manual-${safeSegment(args[0])}`);
    }
    if (command === 'restore' && args[0] === '--help') return usage;
    if (command === 'restore' && (args.length === 3 || args.length === 4)) {
      return restoreSnapshot(args[0], args[1], args[2], Number(args[3] ?? 1));
    }
    throw new Error(usage);
  };
  main().then(console.log).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
