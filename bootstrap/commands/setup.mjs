#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { copyUserAuth, hasUserAuth } from './auth.mjs';
import {
  assertNoSymlinks, copySkills, environmentPaths, environmentsRoot, exists,
  fetchPinnedSource, hashTree, indexPath, legacyEnvironmentsRoot, prepareEnvironmentDataRoot, projectRoot, readJson, run,
  lockEnvironments, workspaceDefault, validateSources, writeJsonAtomic,
} from '../environment/common.mjs';

function parseSkillNames(value) {
  const names = value.split(',').filter(Boolean);
  if (!names.length || new Set(names).size !== names.length || names.some((name) => !/^[a-z0-9][a-z0-9-]*$/.test(name))) {
    throw new Error('Invalid --exclude-workspace-skills value');
  }
  return names.sort();
}

function parseArgs(args) {
  const options = { publicIds: null, archiveExisting: false, copyAuth: false, localWorkspace: null, commonSkillsDir: null, excludeWorkspaceSkills: [], list: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--public' && args[index + 1]) options.publicIds = args[++index].split(',').filter(Boolean);
    else if (arg === '--local-workspace' && args[index + 1]) options.localWorkspace = args[++index];
    else if (arg === '--common-skills-dir' && args[index + 1]) options.commonSkillsDir = args[++index];
    else if (arg === '--exclude-workspace-skills' && args[index + 1]) options.excludeWorkspaceSkills = parseSkillNames(args[++index]);
    else if (arg === '--archive-existing') options.archiveExisting = true;
    else if (arg === '--copy-auth') options.copyAuth = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log('Usage: pnpm run setup [--public id,id | --public none] [--local-workspace path] [--common-skills-dir path] [--exclude-workspace-skills name[,name]] [--archive-existing] [--copy-auth] [--list]');
  console.log('Baseline and codex-workspace are always selected. Without --public, interactive selection is shown.');
  console.log('--archive-existing moves an existing environment to environments/.backups before installing a new one.');
  console.log('--copy-auth copies the current file-based Codex login to managed environments without replacing existing auth files.');
  console.log('--exclude-workspace-skills omits named codex-workspace Skills and records the exclusion in its manifest.');
}

async function localWorkspaceSource(directory, skillsPath, excludedSkillNames) {
  const workspace = await fs.realpath(directory);
  const source = { kind: 'local', path: workspace, skillsPath, excludedSkillNames };
  try {
    const commit = await run('git', ['-C', workspace, 'rev-parse', '--verify', 'HEAD']);
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Invalid local Git commit');
    source.commit = commit;
    source.dirty = Boolean(await run('git', ['-C', workspace, 'status', '--porcelain', '--untracked-files=all']));
  } catch {
    source.commit = null;
    source.dirty = null;
  }
  return source;
}

async function offerAuthCopy(requested) {
  if (!requested && (!stdin.isTTY || !(await hasUserAuth()))) return;
  if (!requested) {
    const terminal = readline.createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await terminal.question('Copy your current Codex login to the benchmark environments? [y/N] ')).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') return;
    } finally {
      terminal.close();
    }
  }
  const { copied, preserved } = await copyUserAuth();
  console.log(`Copied Codex login to ${copied.length} environment(s); preserved existing login in ${preserved.length}.`);
}

async function choosePublic(sources, requested) {
  if (requested !== null) {
    if (requested.length === 1 && requested[0] === 'none') return [];
    const byId = new Map(sources.public.map((source) => [source.id, source]));
    if (new Set(requested).size !== requested.length || requested.some((id) => !byId.has(id))) {
      throw new Error(`Invalid public selection. Available: ${[...byId.keys()].join(', ')}`);
    }
    return requested.map((id) => byId.get(id));
  }
  if (!stdin.isTTY) throw new Error('Use --public id,id or --public none in non-interactive mode');
  console.log('Select public Skill sets by number (comma separated); press Enter for none:');
  sources.public.forEach((source, index) => console.log(`  ${index + 1}. ${source.id} (${source.repository})`));
  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await terminal.question('Selection: ')).trim();
    if (!answer) return [];
    const choices = answer.split(',').map((item) => Number(item.trim()));
    if (new Set(choices).size !== choices.length || choices.some((choice) => !Number.isInteger(choice) || choice < 1 || choice > sources.public.length)) {
      throw new Error('Invalid selection');
    }
    return choices.map((choice) => sources.public[choice - 1]);
  } finally {
    terminal.close();
  }
}

export async function prepareEnvironment(stage, id, source, checkout, codexVersion) {
  const agents = path.join(stage, '.agents');
  const codex = path.join(stage, '.codex');
  await fs.mkdir(path.join(agents, 'skills'), { recursive: true });
  await fs.mkdir(codex);
  await fs.mkdir(path.join(stage, '.config'));
  let skillNames = [];
  let commonSkillNames = [];
  const excludedSkillNames = source.excludedSkillNames ?? [];
  if (source.commonSkills) {
    commonSkillNames = await copySkills(source.commonSkills.path, path.join(agents, 'skills'));
  }
  const commonExclusions = excludedSkillNames.filter((name) => commonSkillNames.includes(name));
  if (commonExclusions.length) throw new Error(`Excluded workspace Skill is installed from common Skills: ${commonExclusions.join(', ')}`);
  if (source.kind !== 'baseline') {
    const root = path.join(checkout, source.skillsPath);
    skillNames = await copySkills(root, path.join(agents, 'skills'), { excludeNames: excludedSkillNames });
  }
  if (id === 'codex-workspace') {
    const agentInstructions = path.join(checkout, 'templates', 'global-AGENTS.md');
    const hooksConfig = path.join(checkout, 'hooks', 'hooks.json');
    const hooksDirectory = path.join(checkout, 'hooks', 'git');
    await Promise.all([assertNoSymlinks(agentInstructions), assertNoSymlinks(hooksConfig), assertNoSymlinks(hooksDirectory)]);
    await fs.copyFile(agentInstructions, path.join(agents, 'AGENTS.md'));
    await fs.copyFile(hooksConfig, path.join(agents, 'hooks.json'));
    await fs.cp(hooksDirectory, path.join(agents, 'hooks', 'git'), { recursive: true });
    await fs.symlink('../.agents/AGENTS.md', path.join(codex, 'AGENTS.md'));
  }
  const manifest = {
    schemaVersion: 1,
    id,
    paths: environmentPaths(id),
    source,
    sourceCommit: source.commit ?? null,
    sourceDirty: source.kind === 'local' ? source.dirty ?? null : false,
    skillNames: [...commonSkillNames, ...skillNames].sort(),
    commonSkillNames,
    excludedSkillNames,
    contentHash: await hashTree(agents),
    codexVersion,
    installedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(path.join(stage, 'environment.json'), manifest);
  return manifest;
}

async function archiveExisting(target, id) {
  const backups = path.join(environmentsRoot, '.backups');
  await fs.mkdir(backups, { recursive: true });
  const backup = path.join(backups, `${id}-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`);
  await fs.rename(target, backup);
  console.log(`Preserved existing ${id}: ${path.relative(projectRoot, backup)}`);
  return backup;
}

async function inspectExisting(id, source) {
  const target = path.join(environmentsRoot, id);
  if (!(await exists(target))) return 'absent';
  if ((await fs.lstat(target)).isSymbolicLink()) throw new Error(`${id} is a symlink; refusing to follow or archive it`);
  const manifestFile = path.join(target, 'environment.json');
  if (await exists(manifestFile)) {
    if ((await fs.lstat(manifestFile)).isSymbolicLink()) throw new Error(`${id} manifest is a symlink`);
    try {
      const existing = await readJson(manifestFile);
      if (JSON.stringify(existing.source) === JSON.stringify(source)) {
        const actual = await hashTree(path.join(target, '.agents'));
        if (existing.contentHash === actual) return 'current';
      }
    } catch {
      return 'conflict';
    }
  }
  return 'conflict';
}

async function confirmArchiving(conflicts, archiveExisting) {
  if (!conflicts.length || archiveExisting) return;
  const labels = conflicts.map((id) => path.join(environmentsRoot, id)).join(', ');
  if (!stdin.isTTY) {
    throw new Error(`${labels} already exists and differs. Inspect it, then use --archive-existing to preserve and replace it.`);
  }
  console.log(`Existing environments need to be preserved before setup: ${labels}`);
  console.log('Their contents, including local authentication state, will be moved to environments/.backups/.');
  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await terminal.question('Archive these environments and continue? [y/N] ')).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') throw new Error('Setup cancelled; existing environments were not changed');
  } finally {
    terminal.close();
  }
}

async function installOne(id, source, allowArchive, codexVersion) {
  const target = path.join(environmentsRoot, id);
  const state = await inspectExisting(id, source);
  if (state === 'current') {
    console.log(`Preserved ${id}: already installed and verified`);
    return;
  }
  if (state === 'conflict' && !allowArchive) throw new Error(`${id} changed after preflight; run setup again`);
  const stage = path.join(environmentsRoot, `.staging-${id}-${randomUUID()}`);
  let checkout = null;
  let backup = null;
  try {
    if (source.kind === 'git') checkout = await fetchPinnedSource(source);
    else if (source.kind === 'local') checkout = await fs.realpath(source.path);
    await fs.mkdir(stage);
    await prepareEnvironment(stage, id, source, checkout, codexVersion);
    if (await exists(target)) backup = await archiveExisting(target, id);
    try {
      await fs.rename(stage, target);
    } catch (error) {
      if (backup) await fs.rename(backup, target);
      throw error;
    }
    console.log(`Installed ${id}: ${source.kind === 'git' ? source.commit : source.kind}`);
  } finally {
    if (checkout && source.kind === 'git') await fs.rm(checkout, { recursive: true, force: true });
    if (await exists(stage)) await fs.rm(stage, { recursive: true, force: true });
  }
}

async function refreshIndex(codexVersion) {
  const environments = [];
  for (const id of (await fs.readdir(environmentsRoot)).sort()) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) continue;
    const manifestFile = path.join(environmentsRoot, id, 'environment.json');
    if (!(await exists(manifestFile))) continue;
    if ((await fs.lstat(path.join(environmentsRoot, id))).isSymbolicLink()) throw new Error(`Environment is a symlink: ${id}`);
    if ((await fs.lstat(manifestFile)).isSymbolicLink()) throw new Error(`Environment manifest is a symlink: ${id}`);
    const manifest = await readJson(manifestFile);
    if (manifest.schemaVersion !== 1 || manifest.id !== id) throw new Error(`Invalid existing manifest: ${id}`);
    environments.push({ id, ...manifest.paths, source: manifest.source, manifest: `./environments/${id}/environment.json` });
  }
  let workspaceDefault;
  if (await exists(indexPath)) {
    if ((await fs.lstat(indexPath)).isSymbolicLink()) throw new Error('Environment index is a symlink');
    const previous = await readJson(indexPath);
    workspaceDefault = previous.workspaceDefault;
    if (previous.schemaVersion !== 1 || !Array.isArray(previous.environments)) throw new Error('Existing environment index is not managed by Bootstrap');
  }
  await writeJsonAtomic(indexPath, { schemaVersion: 1, codexVersion, generatedAt: new Date().toISOString(), workspaceDefault, environments });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  const sources = validateSources(await readJson(path.join(projectRoot, 'bootstrap', 'sources.json')));
  if (options.list) {
    sources.public.forEach(({ id, repository, commit }) => console.log(`${id}\t${commit}\t${repository}`));
    return;
  }
  const selected = await choosePublic(sources, options.publicIds);
  const [gitVersion, codexVersion] = await Promise.all([run('git', ['--version']), run('codex', ['--version'])]);
  console.log(`Using ${process.version}, ${gitVersion}, ${codexVersion}`);
  const commonSkills = options.commonSkillsDir
    ? { path: await fs.realpath(options.commonSkillsDir), contentHash: await hashTree(await fs.realpath(options.commonSkillsDir)) }
    : null;
  if (await exists(legacyEnvironmentsRoot) && !(await exists(environmentsRoot))) {
    throw new Error('Existing project-local environments found. Run pnpm run environments:migrate first.');
  }
  await prepareEnvironmentDataRoot();
  await fs.mkdir(environmentsRoot, { recursive: true, mode: 0o700 });
  if (!(await fs.lstat(environmentsRoot)).isDirectory()) throw new Error('Environments path must be a directory');
  console.log(`Environment directory: ${environmentsRoot}`);
  const lock = await fs.open(environmentsRoot);
  try {
    lockEnvironments(lock, true);
    const workspaceSource = options.localWorkspace
      ? await localWorkspaceSource(options.localWorkspace, sources.workspace.skillsPath, options.excludeWorkspaceSkills)
      : { kind: 'git', ...workspaceDefault(sources, await exists(indexPath) ? await readJson(indexPath) : null), excludedSkillNames: options.excludeWorkspaceSkills };
    if (commonSkills) workspaceSource.commonSkills = commonSkills;
    const installs = [
      ['baseline', { kind: 'baseline', ...(commonSkills ? { commonSkills } : {}) }],
      ['codex-workspace', workspaceSource],
      ...selected.map((source) => [source.id, { kind: 'git', ...source, ...(commonSkills ? { commonSkills } : {}) }]),
    ];
    const conflicts = [];
    for (const [id, source] of installs) {
      if (await inspectExisting(id, source) === 'conflict') conflicts.push(id);
    }
    await confirmArchiving(conflicts, options.archiveExisting);
    for (const [id, source] of installs) {
      await installOne(id, source, options.archiveExisting || conflicts.includes(id), codexVersion);
      await refreshIndex(codexVersion);
    }
  } finally {
    await lock.close();
  }
  await offerAuthCopy(options.copyAuth);
  console.log('Environment setup complete. Run pnpm verify before using the environments.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`Setup failed: ${error.message}`); process.exitCode = 1; });
