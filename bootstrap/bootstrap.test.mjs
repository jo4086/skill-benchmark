import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const bootstrapDirectory = path.dirname(fileURLToPath(import.meta.url));

function fixtureDataHome(project) {
  return path.join(path.dirname(project), 'data');
}

function fixtureEnvironments(project, ...segments) {
  return path.join(fixtureDataHome(project), 'skill-benchmark', 'environments', ...segments);
}

function command(program, args, cwd, env = process.env) {
  const result = spawnSync(program, args, { cwd, env: { ...env, XDG_DATA_HOME: fixtureDataHome(cwd) }, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

function git(args, cwd) {
  const result = command('git', args, cwd);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function interactiveSetup(cwd, answer) {
  return new Promise((resolve, reject) => {
    const child = spawn('script', ['-q', '-e', '-c', `${process.execPath} bootstrap/commands/setup.mjs --public none`, '/dev/null'], {
      cwd,
      env: { ...process.env, XDG_DATA_HOME: fixtureDataHome(cwd) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let sent = false;
    let authAnswered = false;
    const timeout = setTimeout(() => child.kill(), 10000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
      if (!sent && output.includes('Archive these environments and continue?')) {
        child.stdin.write(`${answer}\n`);
        sent = true;
      }
      if (!authAnswered && output.includes('Copy your current Codex login to the benchmark environments?')) {
        child.stdin.write('n\n');
        authAnswered = true;
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, output, sent });
    });
  });
}

async function makeSource(root, name, skillPath) {
  const repository = path.join(root, name);
  await fs.mkdir(path.join(repository, skillPath), { recursive: true });
  const skillName = path.basename(skillPath);
  await fs.writeFile(path.join(repository, skillPath, 'SKILL.md'), `---\nname: ${skillName}\ndescription: Test skill.\n---\n`);
  if (name === 'workspace') {
    await fs.writeFile(path.join(repository, 'AGENTS.md'), '# Repository instructions\n');
    await fs.mkdir(path.join(repository, 'templates'));
    await fs.writeFile(path.join(repository, 'templates', 'global-AGENTS.md'), '# Test global instructions\n');
    await fs.mkdir(path.join(repository, 'hooks', 'git'), { recursive: true });
    await fs.writeFile(path.join(repository, 'hooks', 'hooks.json'), '{}\n');
    await fs.writeFile(path.join(repository, 'hooks', 'git', 'hook.mjs'), 'export default true;\n');
  }
  git(['init', '-q'], repository);
  git(['-c', 'user.name=Benchmark Test', '-c', 'user.email=test@example.invalid', 'add', '.'], repository);
  git(['-c', 'user.name=Benchmark Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], repository);
  return { repository, commit: git(['rev-parse', 'HEAD'], repository) };
}

test('setup preserves unmanaged environments, installs pinned sources, and detects changes', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-test-'));
  try {
    const project = path.join(temporary, 'project');
    await fs.mkdir(project);
    await fs.cp(bootstrapDirectory, path.join(project, 'bootstrap'), { recursive: true });
    const workspace = await makeSource(temporary, 'workspace', 'skills/workflow');
    const publicSource = await makeSource(temporary, 'public', 'skills/engineering/example');
    const common = path.join(temporary, 'common');
    await fs.mkdir(path.join(common, 'shared'), { recursive: true });
    await fs.writeFile(path.join(common, 'shared', 'SKILL.md'), '---\nname: shared\ndescription: Common Skill.\n---\n');
    await fs.writeFile(path.join(project, 'bootstrap', 'sources.json'), JSON.stringify({
      schemaVersion: 1,
      workspace: { id: 'codex-workspace', ...workspace, skillsPath: 'skills' },
      public: [{ id: 'public-one', ...publicSource, skillsPath: 'skills' }],
    }));
    await fs.mkdir(path.dirname(fixtureEnvironments(project)), { recursive: true, mode: 0o700 });
    const baseline = fixtureEnvironments(project, 'baseline');
    await fs.mkdir(baseline, { recursive: true });
    await fs.writeFile(path.join(baseline, 'marker'), 'preserve me');
    const oldWorkspace = fixtureEnvironments(project, 'codex-workspace');
    await fs.mkdir(oldWorkspace);
    await fs.writeFile(path.join(oldWorkspace, 'marker'), 'preserve workspace');

    const args = ['bootstrap/commands/setup.mjs', '--public', 'public-one', '--common-skills-dir', common];
    const blocked = command(process.execPath, args, project);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /already exists and differs/);
    assert.equal(await fs.readFile(path.join(baseline, 'marker'), 'utf8'), 'preserve me');
    assert.equal(await fs.readFile(path.join(oldWorkspace, 'marker'), 'utf8'), 'preserve workspace');
    await assert.rejects(fs.stat(fixtureEnvironments(project, 'public-one')), { code: 'ENOENT' });

    const installed = command(process.execPath, [...args, '--archive-existing'], project);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(command(process.execPath, ['bootstrap/commands/verify.mjs'], project).status, 0);
    for (const id of ['baseline', 'codex-workspace', 'public-one']) {
      assert.equal(await fs.readFile(fixtureEnvironments(project, id, '.agents', 'skills', 'shared', 'SKILL.md'), 'utf8'), '---\nname: shared\ndescription: Common Skill.\n---\n');
    }
    assert.equal(await fs.readFile(fixtureEnvironments(project, 'codex-workspace', '.agents', 'AGENTS.md'), 'utf8'), '# Test global instructions\n');
    assert.equal(await fs.readlink(fixtureEnvironments(project, 'codex-workspace', '.codex', 'AGENTS.md')), '../.agents/AGENTS.md');
    const workspaceManifest = JSON.parse(await fs.readFile(fixtureEnvironments(project, 'codex-workspace', 'environment.json'), 'utf8'));
    assert.equal(workspaceManifest.sourceCommit, workspace.commit);
    assert.deepEqual(workspaceManifest.excludedSkillNames, []);
    const backups = await fs.readdir(fixtureEnvironments(project, '.backups'));
    assert.equal(backups.length, 2);
    assert.equal(await fs.readFile(fixtureEnvironments(project, '.backups', backups.find((name) => name.startsWith('baseline-')), 'marker'), 'utf8'), 'preserve me');
    assert.equal(await fs.readFile(fixtureEnvironments(project, '.backups', backups.find((name) => name.startsWith('codex-workspace-')), 'marker'), 'utf8'), 'preserve workspace');
    assert.equal(command(process.execPath, args, project).status, 0);

    const sourcesFile = path.join(project, 'bootstrap', 'sources.json');
    const originalSources = await fs.readFile(sourcesFile, 'utf8');
    const changedSources = JSON.parse(originalSources);
    changedSources.public[0].commit = '0'.repeat(40);
    await fs.writeFile(sourcesFile, JSON.stringify(changedSources));
    assert.match(command(process.execPath, ['bootstrap/commands/verify.mjs'], project).stderr, /differs from sources.json/);
    await fs.writeFile(sourcesFile, originalSources);

    const skillFile = fixtureEnvironments(project, 'public-one', '.agents', 'skills', 'example', 'SKILL.md');
    await fs.appendFile(skillFile, '\nchanged\n');
    const failedVerification = command(process.execPath, ['bootstrap/commands/verify.mjs'], project);
    assert.notEqual(failedVerification.status, 0);
    assert.match(failedVerification.stderr, /managed content changed/);
    assert.notEqual(command(process.execPath, args, project).status, 0);
    assert.match(await fs.readFile(skillFile, 'utf8'), /changed/);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('a failed public source does not alter successfully installed environments', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-failure-test-'));
  try {
    const project = path.join(temporary, 'project');
    await fs.mkdir(project);
    await fs.cp(bootstrapDirectory, path.join(project, 'bootstrap'), { recursive: true });
    const workspace = await makeSource(temporary, 'workspace', 'skills/workflow');
    const publicSource = await makeSource(temporary, 'public', 'skills/example');
    await fs.writeFile(path.join(project, 'bootstrap', 'sources.json'), JSON.stringify({
      schemaVersion: 1,
      workspace: { id: 'codex-workspace', ...workspace, skillsPath: 'skills' },
      public: [
        { id: 'good', ...publicSource, skillsPath: 'skills' },
        { id: 'bad', ...publicSource, commit: '0'.repeat(40), skillsPath: 'skills' },
      ],
    }));
    const result = command(process.execPath, ['bootstrap/commands/setup.mjs', '--public', 'good,bad'], project);
    assert.notEqual(result.status, 0);
    assert.equal(await fs.readFile(fixtureEnvironments(project, 'good', '.agents', 'skills', 'example', 'SKILL.md'), 'utf8'), '---\nname: example\ndescription: Test skill.\n---\n');
    assert.equal(command(process.execPath, ['bootstrap/commands/verify.mjs'], project).status, 0);
    await assert.rejects(fs.stat(fixtureEnvironments(project, 'bad')), { code: 'ENOENT' });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('local workspace mode records Git provenance and intentional Skill exclusions', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-local-test-'));
  try {
    const project = path.join(temporary, 'project');
    await fs.mkdir(project);
    await fs.cp(bootstrapDirectory, path.join(project, 'bootstrap'), { recursive: true });
    const workspace = await makeSource(temporary, 'workspace', 'skills/workflow');
    await fs.writeFile(path.join(project, 'bootstrap', 'sources.json'), JSON.stringify({
      schemaVersion: 1,
      workspace: { id: 'codex-workspace', ...workspace, skillsPath: 'skills' },
      public: [],
    }));
    const sourceSkill = path.join(workspace.repository, 'skills', 'workflow', 'SKILL.md');
    const original = await fs.readFile(sourceSkill, 'utf8');
    await fs.writeFile(path.join(workspace.repository, 'uncommitted.txt'), 'dirty\n');
    const result = command(process.execPath, ['bootstrap/commands/setup.mjs', '--public', 'none', '--local-workspace', workspace.repository,
      '--exclude-workspace-skills', 'workflow'], project);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await fs.readFile(fixtureEnvironments(project, 'codex-workspace', 'environment.json'), 'utf8'));
    assert.equal(manifest.source.kind, 'local');
    assert.equal(manifest.source.path, workspace.repository);
    assert.equal(manifest.sourceCommit, workspace.commit);
    assert.equal(manifest.sourceDirty, true);
    assert.deepEqual(manifest.skillNames, []);
    assert.deepEqual(manifest.excludedSkillNames, ['workflow']);
    await assert.rejects(fs.stat(fixtureEnvironments(project, 'codex-workspace', '.agents', 'skills', 'workflow')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(sourceSkill, 'utf8'), original);
    assert.equal(command(process.execPath, ['bootstrap/commands/verify.mjs'], project).status, 0);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('interactive setup asks before archiving existing environments', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-prompt-test-'));
  try {
    const project = path.join(temporary, 'project');
    await fs.mkdir(project);
    await fs.cp(bootstrapDirectory, path.join(project, 'bootstrap'), { recursive: true });
    const workspace = await makeSource(temporary, 'workspace', 'skills/workflow');
    await fs.writeFile(path.join(project, 'bootstrap', 'sources.json'), JSON.stringify({
      schemaVersion: 1,
      workspace: { id: 'codex-workspace', ...workspace, skillsPath: 'skills' },
      public: [],
    }));
    await fs.mkdir(path.dirname(fixtureEnvironments(project)), { recursive: true, mode: 0o700 });
    const baseline = fixtureEnvironments(project, 'baseline');
    await fs.mkdir(baseline, { recursive: true });
    await fs.writeFile(path.join(baseline, 'marker'), 'unchanged');
    const declined = await interactiveSetup(project, 'n');
    assert.equal(declined.sent, true, declined.output);
    assert.notEqual(declined.code, 0);
    assert.equal(await fs.readFile(path.join(baseline, 'marker'), 'utf8'), 'unchanged');
    const accepted = await interactiveSetup(project, 'y');
    assert.equal(accepted.sent, true, accepted.output);
    assert.equal(accepted.code, 0, accepted.output);
    assert.equal(command(process.execPath, ['bootstrap/commands/verify.mjs'], project).status, 0);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('opt-in auth copy uses private files and preserves existing environment logins', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-auth-test-'));
  try {
    const project = path.join(temporary, 'project');
    await fs.mkdir(project);
    await fs.cp(bootstrapDirectory, path.join(project, 'bootstrap'), { recursive: true });
    const workspace = await makeSource(temporary, 'workspace', 'skills/workflow');
    await fs.writeFile(path.join(project, 'bootstrap', 'sources.json'), JSON.stringify({
      schemaVersion: 1,
      workspace: { id: 'codex-workspace', ...workspace, skillsPath: 'skills' },
      public: [],
    }));
    const userCodexHome = path.join(temporary, 'user-codex');
    await fs.mkdir(userCodexHome);
    const fakeAuth = '{"token":"test-only-placeholder"}\n';
    await fs.writeFile(path.join(userCodexHome, 'auth.json'), fakeAuth, { mode: 0o600 });
    const env = { ...process.env, CODEX_HOME: userCodexHome };
    const result = command(process.execPath, ['bootstrap/commands/setup.mjs', '--public', 'none', '--local-workspace', workspace.repository, '--copy-auth'], project, env);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /test-only-placeholder/);
    for (const id of ['baseline', 'codex-workspace']) {
      const auth = fixtureEnvironments(project, id, '.codex', 'auth.json');
      assert.equal(await fs.readFile(auth, 'utf8'), fakeAuth);
      assert.equal((await fs.stat(auth)).mode & 0o777, 0o600);
      assert.doesNotMatch(await fs.readFile(fixtureEnvironments(project, id, 'environment.json'), 'utf8'), /test-only-placeholder/);
    }
    await fs.writeFile(path.join(userCodexHome, 'auth.json'), '{"token":"new-placeholder"}\n');
    const second = command(process.execPath, ['bootstrap/commands/auth.mjs'], project, env);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /preserved existing login in 2/);
    const installed = fixtureEnvironments(project);
    const legacy = path.join(project, 'environments');
    const auth = fixtureEnvironments(project, 'baseline', '.codex', 'auth.json');
    assert.equal(await fs.readFile(auth, 'utf8'), fakeAuth);
    const originalStat = await fs.stat(auth);
    await fs.mkdir(legacy);
    const conflict = command(process.execPath, ['bootstrap/commands/migrate.mjs'], project, env);
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /Destination already exists/);
    await fs.rmdir(legacy);
    await fs.rename(installed, legacy);
    const migrated = command(process.execPath, ['bootstrap/commands/migrate.mjs'], project, env);
    assert.equal(migrated.status, 0, migrated.stderr);
    assert.doesNotMatch(migrated.stdout + migrated.stderr, /test-only-placeholder/);
    const migratedStat = await fs.stat(auth);
    assert.equal(migratedStat.ino, originalStat.ino);
    assert.equal(migratedStat.mode, originalStat.mode);
    assert.equal(command(process.execPath, ['bootstrap/commands/verify.mjs'], project, env).status, 0);
    await assert.rejects(fs.stat(legacy), { code: 'ENOENT' });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('workspace version selection preserves login and persists the accepted commit across setup', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-update-test-'));
  try {
    const project = path.join(temporary, 'project');
    await fs.mkdir(project);
    await fs.cp(bootstrapDirectory, path.join(project, 'bootstrap'), { recursive: true });
    const repository = await makeSource(temporary, 'workspace', 'skills/workflow');
    const workspace = { id: 'codex-workspace', ...repository, skillsPath: 'skills' };
    await fs.writeFile(path.join(project, 'bootstrap/sources.json'), JSON.stringify({ schemaVersion: 1, workspace, public: [] }));
    const setup = () => command(process.execPath, ['bootstrap/commands/setup.mjs', '--public', 'none'], project);
    assert.equal(setup().status, 0);
    const home = fixtureEnvironments(project, workspace.id);
    const auth = path.join(home, '.codex/auth.json');
    await fs.writeFile(auth, 'fixture');
    await fs.appendFile(path.join(repository.repository, 'templates/global-AGENTS.md'), 'updated\n');
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qam', 'update'], repository.repository);
    const latest = git(['rev-parse', 'HEAD'], repository.repository);
    const check = (answer) => command(process.execPath, ['--input-type=module', '-e', `
      import { promises as fs } from 'node:fs';
      import { environmentsRoot, lockEnvironments, readJson } from './bootstrap/environment/common.mjs';
      import { checkWorkspaceUpdate } from './bootstrap/commands/workspace-update.mjs';
      const lock = await fs.open(environmentsRoot);
      lockEnvironments(lock, false);
      const home = environmentsRoot + '/codex-workspace';
      const manifest = await readJson(home + '/environment.json');
      await checkWorkspaceUpdate({ ...manifest, home }, manifest.codexVersion, lock, ${answer});
      await lock.close();
    `], project);
    const installed = async () => JSON.parse(await fs.readFile(path.join(home, 'environment.json'))).source.commit;
    assert.equal(check('undefined').status, 0);
    assert.equal(check('() => false').status, 0);
    assert.equal(await installed(), workspace.commit);
    const updated = check('() => true');
    assert.equal(updated.status, 0, updated.stderr);
    assert.equal(await installed(), latest);
    assert.equal(await fs.readFile(auth, 'utf8'), 'fixture');
    assert.match(await fs.readFile(path.join(home, '.codex/AGENTS.md'), 'utf8'), /updated/);
    assert.equal(command(process.execPath, ['bootstrap/commands/verify.mjs'], project).status, 0);
    assert.equal(setup().status, 0);
    assert.equal(check('() => { throw new Error("unexpected prompt"); }').status, 0);
    assert.equal(await installed(), latest);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
