#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { run } from '../bootstrap/environment/common.mjs';
import { discoverCatalog, discoverRegistered, filterCatalog, registerTasks, repository } from './management/catalog.mjs';

const tasksRoot = path.dirname(fileURLToPath(import.meta.url));
const usage = `Usage: pnpm run tasks -- <search|register> [options]
  --id TEXT          Filter by upstream or registered ID
  --name TEXT        Filter by name
  --domain TEXT      Filter by domain
  --difficulty TEXT  Filter by difficulty
  --source TEXT      Filter by source
  --ids ID,ID        Register multiple upstream IDs without prompting
`;

function parseArgs(args) {
  const command = args[0] === '--' ? args[1] : args[0];
  const start = args[0] === '--' ? 2 : 1;
  if (command === '--help' || !command) return { help: true };
  if (!['search', 'register'].includes(command)) throw new Error('Expected search or register');
  const options = { command, filters: {} };
  for (let index = start; index < args.length; index += 1) {
    const key = args[index].replace(/^--/, '');
    if (!['id', 'name', 'domain', 'difficulty', 'source', 'ids'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(`Unknown or incomplete option: ${args[index]}`);
    }
    if (key === 'ids') options.ids = args[++index].split(',');
    else options.filters[key] = args[++index];
  }
  if (command === 'search' && options.ids) throw new Error('--ids is only valid with register');
  return options;
}

async function chooseIds(catalog) {
  if (!stdin.isTTY) throw new Error('Use --ids ID,ID in a non-interactive shell');
  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    const choice = await terminal.question('Select problem numbers (comma separated): ');
    const numbers = choice.split(',').map((part) => Number(part.trim()));
    if (!numbers.length || new Set(numbers).size !== numbers.length || numbers.some((value) => !Number.isInteger(value) || value < 1 || value > catalog.length)) {
      throw new Error('Invalid selection');
    }
    return numbers.map((number) => catalog[number - 1].id);
  } finally { terminal.close(); }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage); return; }
  const registered = await discoverRegistered(tasksRoot);
  if (options.command === 'search' && /mentor/i.test(options.filters.source ?? '')
    && !/wizard/i.test(options.filters.source ?? '')) {
    filterCatalog(registered, options.filters).forEach((item) => console.log(`${item.taskId}\t${item.name}\t${item.domain}\t${item.difficulty ?? 'unknown'}\t${item.source}\tregistered`));
    return;
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-benchmark-catalog-'));
  const checkout = path.join(temporary, 'checkout');
  try {
    const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_TERMINAL_PROMPT: '0' };
    await run('git', ['clone', '--quiet', '--depth', '1', '--single-branch', repository, checkout], { env: gitEnv });
    const commit = await run('git', ['-C', checkout, 'rev-parse', 'HEAD'], { env: gitEnv });
    const catalog = filterCatalog(await discoverCatalog(checkout), options.filters);
    console.log(`Source: ${repository} @ ${commit}`);
    if (options.command === 'search') {
      const known = new Set(registered.map((item) => item.taskId));
      const available = catalog.filter((item) => !known.has(item.taskId));
      const matches = [...filterCatalog(registered, options.filters), ...available];
      matches.forEach((item) => console.log(`${item.taskId}\t${item.name}\t${item.domain}\t${item.difficulty ?? 'unknown'}\t${item.source}\t${item.registered ? 'registered' : 'available'}`));
      return;
    }
    catalog.forEach((item, index) => console.log(`${index + 1}. ${item.id}\t${item.name}\t${item.domain}\t${item.difficulty ?? 'unknown'}\t${item.source}`));
    const ids = options.ids || await chooseIds(catalog);
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Select unique problem IDs');
    const selected = ids.map((id) => {
      const item = catalog.find((candidate) => candidate.id === id);
      if (!item) throw new Error(`Unknown or filtered-out problem: ${id}`);
      return item;
    });
    for (const result of await registerTasks({ checkout, commit, selected, tasksRoot })) {
      console.log(`${result.status}: ${result.id} -> ${result.taskId}`);
    }
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Task catalog failed: ${error.message}`); process.exitCode = 1; });
}
