import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const excludedNames = new Set([
  'node_modules', 'dist', 'build', '.git', '.codex', '.agents', '.claude',
  'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'SKILL.md', '.env', '.env.local', '.env.production',
  'auth.json', 'evaluation', 'coverage', '.promptfoo', 'screenshots', 'playwright-report', 'test-results', 'self-validation.log',
]);

function allowed(name, relative = '') {
  if (relative === 'reference') return name === 'assets';
  return !excludedNames.has(name) && !name.startsWith('.env.') && !name.endsWith('.tsbuildinfo')
    && !/\.mdx?$/i.test(name);
}

export async function copyEvaluationSnapshot(source, destination) {
  const hash = createHash('sha256');
  async function visit(from, to, relative = '') {
    await fs.mkdir(to, { recursive: true, mode: 0o700 });
    for (const name of (await fs.readdir(from)).sort()) {
      if (!allowed(name, relative)) continue;
      const input = path.join(from, name);
      const output = path.join(to, name);
      const stat = await fs.lstat(input);
      if (stat.isSymbolicLink()) throw new Error(`Symlink in evaluation input: ${path.join(relative, name)}`);
      if (stat.isDirectory()) await visit(input, output, path.join(relative, name));
      else if (stat.isFile()) {
        hash.update(path.posix.join(relative, name)).update('\0');
        const data = await fs.readFile(input);
        hash.update(data);
        await fs.writeFile(output, data, { mode: 0o600, flag: 'wx' });
      }
    }
  }
  await visit(source, destination);
  return hash.digest('hex');
}

export async function hashEvaluationSnapshot(source) {
  const hash = createHash('sha256');
  async function visit(directory, relative = '') {
    for (const name of (await fs.readdir(directory)).sort()) {
      if (!allowed(name, relative)) continue;
      const input = path.join(directory, name);
      const stat = await fs.lstat(input);
      if (stat.isSymbolicLink()) throw new Error(`Symlink in evaluation input: ${path.join(relative, name)}`);
      if (stat.isDirectory()) await visit(input, path.join(relative, name));
      else if (stat.isFile()) hash.update(path.posix.join(relative, name)).update('\0').update(await fs.readFile(input));
    }
  }
  await visit(source);
  return hash.digest('hex');
}
