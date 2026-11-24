import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoSymlinks, exists, hashTree, readJson, writeJsonAtomic } from '../../bootstrap/environment/common.mjs';

export const repository = 'https://github.com/frontendwizards/frontend-challenges.git';

function titleFromReadme(readme, id) {
  const heading = readme.match(/^#\s+(.+)$/m)?.[1];
  return heading?.replace(/\s+Challenge$/i, '') || id.replaceAll('-', ' ');
}

export async function discoverCatalog(checkout) {
  const problems = path.join(checkout, 'problems');
  const index = await fs.readFile(path.join(checkout, 'README.md'), 'utf8');
  const metadata = new Map();
  for (const line of index.split('\n')) {
    const match = line.match(/^\|\s*\[([^\]]+)\]\(https:\/\/frontwizards\.com\/challenge\/user-interface\/([^/)]+)\)\s*\|\s*([^|]+)\s*\|/);
    if (match) metadata.set(match[2].toLowerCase(), { name: match[1], difficulty: match[3].trim().toLowerCase() });
  }
  const catalog = [];
  for (const slug of (await fs.readdir(problems)).sort()) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(slug)) continue;
    const directory = path.join(problems, slug);
    if (!(await fs.lstat(directory)).isDirectory()) continue;
    const readmeFile = path.join(directory, 'README.md');
    if (!(await exists(readmeFile))) continue;
    const readme = await fs.readFile(readmeFile, 'utf8');
    const details = metadata.get(slug.toLowerCase());
    catalog.push({ id: slug, taskId: `FW-${slug}`, name: details?.name || titleFromReadme(readme, slug),
      domain: 'frontend', difficulty: details?.difficulty || null, source: 'frontendwizards', sourceUrl: repository });
  }
  return catalog;
}

export function filterCatalog(catalog, filters) {
  return catalog.filter((item) => Object.entries(filters).every(([key, query]) => {
    if (!query) return true;
    const value = key === 'id' ? `${item.id} ${item.taskId}`
      : key === 'source' ? `${item.source} ${item.sourceUrl ?? ''}` : item[key];
    const normalize = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
    return normalize(value).includes(normalize(query));
  }));
}

export async function discoverRegistered(tasksRoot) {
  const tasks = [];
  for (const entry of (await fs.readdir(tasksRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const directory = entry.name;
    const manifestFile = path.join(tasksRoot, directory, 'manifest.json');
    if (!(await exists(manifestFile))) continue;
    const manifest = await readJson(manifestFile);
    if (manifest.schemaVersion !== 1 || manifest.id !== directory) continue;
    tasks.push({ id: manifest.source?.kind === 'git' ? manifest.source.problemPath?.split('/').at(-1) : manifest.id,
      taskId: manifest.id, name: manifest.name, domain: manifest.domain, difficulty: manifest.difficulty,
      source: manifest.source?.kind === 'zip' ? 'frontend-mentor' : 'frontendwizards',
      sourceUrl: manifest.source?.url ?? manifest.source?.repository, registered: true });
  }
  return tasks;
}

async function alreadyRegistered(tasksRoot, problemPath) {
  for (const entry of await fs.readdir(tasksRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^FW-/.test(entry.name)) continue;
    const file = path.join(tasksRoot, entry.name, 'manifest.json');
    if (!(await exists(file))) continue;
    const manifest = await readJson(file);
    if (manifest.source?.repository === repository && manifest.source?.problemPath === problemPath) return entry.name;
  }
  return null;
}

export async function registerTasks({ checkout, commit, selected, tasksRoot }) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Invalid source commit');
  const results = [];
  for (const item of selected) {
    const problemPath = `problems/${item.id}`;
    const existing = await alreadyRegistered(tasksRoot, problemPath);
    const destination = path.join(tasksRoot, item.taskId);
    if (existing || await exists(destination)) {
      results.push({ id: item.id, status: 'duplicate', taskId: existing || item.taskId });
      continue;
    }
    const sourceProblem = path.join(checkout, problemPath);
    await assertNoSymlinks(sourceProblem);
    const specificStarter = path.join(sourceProblem, 'starter');
    const hasSpecificStarter = await exists(specificStarter);
    const genericStarter = path.join(checkout, 'starter', 'solutions', 'react-ts');
    const starterPath = hasSpecificStarter ? 'source/problem/starter' : 'source/generic-starter';
    if (!hasSpecificStarter) await assertNoSymlinks(genericStarter);
    const stage = path.join(tasksRoot, `.staging-${item.taskId}-${randomUUID()}`);
    try {
      await fs.mkdir(path.join(stage, 'source'), { recursive: true });
      await fs.cp(sourceProblem, path.join(stage, 'source', 'problem'), { recursive: true });
      if (!hasSpecificStarter) await fs.cp(genericStarter, path.join(stage, 'source', 'generic-starter'), { recursive: true });
      const originalReadme = await fs.readFile(path.join(sourceProblem, 'README.md'), 'utf8');
      await fs.writeFile(path.join(stage, 'task.md'), `${originalReadme.trim()}\n\nSource: ${repository} at commit ${commit}, ${problemPath}.\n`);
      const contentHash = await hashTree(path.join(stage, 'source'));
      await writeJsonAtomic(path.join(stage, 'manifest.json'), {
        schemaVersion: 1, id: item.taskId, name: item.name, domain: item.domain,
        difficulty: item.difficulty, techSpec: 'frontend', prompt: 'task.md',
        source: { kind: 'git', repository, commit, problemPath, contentHash, starterPath: hasSpecificStarter ? `${problemPath}/starter` : 'starter/solutions/react-ts' },
        input: { kind: 'starter', path: starterPath },
      });
      await fs.rename(stage, destination);
      results.push({ id: item.id, status: 'registered', taskId: item.taskId });
    } catch (error) {
      await fs.rm(stage, { recursive: true, force: true });
      throw error;
    }
  }
  return results;
}
