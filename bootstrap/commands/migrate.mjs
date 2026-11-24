import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  environmentsRoot, exists, legacyEnvironmentsRoot, prepareEnvironmentDataRoot, readJson, run,
} from '../environment/common.mjs';

async function main() {
  if (process.argv.slice(2).includes('--help')) {
    console.log('Usage: pnpm run environments:migrate');
    return;
  }
  if (process.argv.length !== 2) throw new Error('Usage: pnpm run environments:migrate');
  if (!(await exists(legacyEnvironmentsRoot))) {
    if (await exists(environmentsRoot)) {
      console.log(`Environment directory: ${environmentsRoot}`);
      return;
    }
    throw new Error('No project-local environments to migrate');
  }
  if (await exists(environmentsRoot)) throw new Error(`Destination already exists: ${environmentsRoot}`);
  if (!(await fs.lstat(legacyEnvironmentsRoot)).isDirectory()) throw new Error('Project-local environment path must be a directory');
  const indexPath = path.join(legacyEnvironmentsRoot, 'index.json');
  if (!(await fs.lstat(indexPath)).isFile()) throw new Error('Project-local environment index must be a regular file');
  const index = await readJson(indexPath);
  if (index.schemaVersion !== 1 || !Array.isArray(index.environments)) throw new Error('Invalid project-local environment index');
  await prepareEnvironmentDataRoot();
  await run('mv', ['--no-copy', '--no-clobber', '--no-target-directory', '--', legacyEnvironmentsRoot, environmentsRoot]);
  if (await exists(legacyEnvironmentsRoot)) throw new Error(`Destination already exists: ${environmentsRoot}`);
  console.log(`Moved benchmark environments to ${environmentsRoot}`);
}

main().catch((error) => { console.error(`Environment migration failed: ${error.message}`); process.exitCode = 1; });
