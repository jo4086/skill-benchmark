import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { environmentsRoot, fetchPinnedSource, hashTree, indexPath, lockEnvironments, projectRoot, readJson, run, writeJsonAtomic } from '../environment/common.mjs';
import { prepareEnvironment } from './setup.mjs';

async function confirmUpdate(current, latest) {
  console.log(`codex-workspace 설치 버전 ${current} → 원격 기본 브랜치 ${latest}`);
  if (!process.stdin.isTTY) {
    console.log('비대화형 실행은 설치 버전을 사용합니다.');
    return false;
  }
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question('표시된 원격 커밋을 설치하고 다음 테스트의 기본값으로 저장할까요? [y/N] ');
    return ['y', 'yes'].includes(answer.trim().toLowerCase());
  } finally {
    terminal.close();
  }
}

// Caller holds a shared lock from environment verification through the last trial.
export async function checkWorkspaceUpdate(environment, codexVersion, lock, confirm = confirmUpdate) {
  if (environment.source.kind !== 'git') return;
  const { repository, commit, commonSkills } = environment.source;
  let latest;
  try {
    const { stdout } = await promisify(execFile)('git', ['ls-remote', '--exit-code', repository, 'HEAD'], {
      timeout: 10000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    latest = /^([0-9a-f]{40})\s+HEAD$/.exec(stdout.trim())?.[1];
    if (!latest) throw new Error('Invalid remote HEAD');
  } catch {
    console.warn(`codex-workspace 원격 버전을 확인할 수 없어 설치된 ${commit}을 사용합니다.`);
    return;
  }
  if (latest === commit || !await confirm(commit, latest)) return;

  lockEnvironments(lock, true);
  const index = await readJson(indexPath);
  const entry = index.environments.find(({ id }) => id === environment.id);
  const target = environment.home;
  const manifestPath = path.join(target, 'environment.json');
  const original = await readJson(manifestPath);
  if (entry?.source.commit !== commit || original.source.commit !== commit ||
      await hashTree(path.join(target, '.agents')) !== environment.contentHash) {
    throw new Error('Workspace changed during version selection. Retry the benchmark.');
  }
  if (commonSkills && await hashTree(commonSkills.path) !== commonSkills.contentHash) {
    throw new Error('Common skills changed since setup. Check the shared skills before updating.');
  }

  const source = { ...environment.source, commit: latest };
  const stage = await fs.mkdtemp(path.join(environmentsRoot, '.workspace-update-'));
  const agents = path.join(target, '.agents');
  const backup = path.join(stage, 'previous-agents');
  let checkout;
  let preserved = false;
  try {
    checkout = await fetchPinnedSource(source);
    const manifest = await prepareEnvironment(stage, environment.id, source, checkout, codexVersion);
    await fs.rename(agents, backup);
    preserved = true;
    try {
      await fs.rename(path.join(stage, '.agents'), agents);
      await writeJsonAtomic(manifestPath, manifest);
      entry.source = source;
      await writeJsonAtomic(indexPath, { ...index, generatedAt: new Date().toISOString(), workspaceDefault: { repository, commit: latest } });
    } catch (error) {
      await fs.rm(agents, { recursive: true, force: true });
      await fs.rename(backup, agents);
      await writeJsonAtomic(manifestPath, original);
      preserved = false;
      throw error;
    }
    preserved = false;
    environment.source = source;
    environment.contentHash = manifest.contentHash;
    console.log(`codex-workspace 기본 버전을 ${latest}로 변경했습니다.`);
  } finally {
    if (!preserved) await fs.rm(stage, { recursive: true, force: true });
    if (checkout) await fs.rm(checkout, { recursive: true, force: true });
  }
  lockEnvironments(lock, false);
}

// test-isolation.sh keeps descriptor 9 locked while interactive Codex is open.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const lock = { fd: 9 };
    lockEnvironments(lock, false);
    await run(process.execPath, [path.join(projectRoot, 'bootstrap', 'verify.mjs')]);
    const home = path.join(environmentsRoot, 'codex-workspace');
    const manifest = await readJson(path.join(home, 'environment.json'));
    await checkWorkspaceUpdate({ ...manifest, home }, manifest.codexVersion, lock);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
