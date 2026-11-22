import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const evidenceDirectories = ['screenshots/playwright', 'playwright-report', 'test-results'];
const evidenceFiles = ['self-validation.log'];

async function copyEvidence(workDir, outputDir) {
  const files = [];
  const destination = path.join(outputDir, 'self-validation');
  async function visit(relative) {
    const input = path.join(workDir, relative);
    let stat;
    try { stat = await fs.lstat(input); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`Self-validation evidence is a symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(input)).sort()) await visit(path.join(relative, name));
    } else if (stat.isFile()) {
      const data = await fs.readFile(input);
      const target = path.join(destination, relative);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, data, { flag: 'wx', mode: 0o600 });
      files.push({ path: relative.split(path.sep).join('/'), bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex') });
    }
  }
  for (const relative of [...evidenceDirectories, ...evidenceFiles]) await visit(relative);
  return files;
}

export async function collectSelfValidation(workDir, eventsFile, outputDir) {
  const files = await copyEvidence(workDir, outputDir);
  let events = '';
  try { events = await fs.readFile(eventsFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const browserCommands = [];
  for (const line of events.split('\n')) {
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const item = event.item;
    if (event.type !== 'item.completed' || item?.type !== 'command_execution') continue;
    const command = item.command ?? '';
    if (/(?:pnpm|npm|yarn)\s+(?:add|install)\b/.test(command)) continue;
    let usesBrowser = /(?:\bplaywright\b|\bchromium\b|\bgoogle-chrome\b|\bscreenshot\b)/i.test(command);
    if (!usesBrowser) {
      const script = command.match(/\bnode\s+([\w./-]+\.[cm]?js)\b/);
      if (script && !script[1].startsWith('/') && !script[1].split('/').includes('..')) {
        try { usesBrowser = /(?:from\s+['"]playwright['"]|require\(['"]playwright['"]\)|chromium\.launch)/.test(await fs.readFile(path.join(workDir, script[1]), 'utf8')); }
        catch { /* A temporary script may have been removed after execution. */ }
      }
    }
    if (!usesBrowser) continue;
    browserCommands.push({ command, exitCode: item.exit_code ?? null, status: item.status ?? null });
  }
  const screenshots = files.filter((file) => file.path.startsWith('screenshots/playwright/') && /\.(png|jpe?g|webp)$/i.test(file.path));
  const observed = browserCommands.length > 0 || screenshots.length > 0 || files.some((file) => file.path.startsWith('playwright-report/') || file.path.startsWith('test-results/'));
  const failedCommands = browserCommands.filter((item) => item.exitCode !== 0 || item.status !== 'completed');
  const status = !observed ? 'not_observed' : failedCommands.length ? 'failed' : browserCommands.length ? 'succeeded' : 'outcome_unknown';
  return { status, playwrightUseObserved: observed, browserCommandCount: browserCommands.length,
    browserCommands, screenshotCount: screenshots.length, evidenceDirectory: files.length ? 'self-validation' : null, files,
    note: 'Observed commands and files describe agent self-validation; they are not Evaluator results.' };
}
