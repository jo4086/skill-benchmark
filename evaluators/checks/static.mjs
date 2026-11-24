import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { projectRoot } from '../../bootstrap/environment/common.mjs';
import { command } from './frontend-common.mjs';

export const staticEvaluatorVersion = 1;
export const staticToolVersions = Object.freeze({ eslint: '9.39.5', typescriptEslint: '8.56.0' });

export async function evaluateStatic(workDir, home) {
  const benchmarkConfig = path.join(workDir, 'tsconfig.benchmark.json');
  await fs.writeFile(benchmarkConfig, JSON.stringify({
    extends: path.join(projectRoot, 'tasks', 'shared', 'frontend', 'template', 'tsconfig.json'),
    include: [path.join(workDir, 'src', '**', '*'), path.join(workDir, 'vite.config.ts')],
    exclude: [path.join(workDir, 'node_modules'), path.join(workDir, 'dist')],
    compilerOptions: { noEmit: true, strict: true, noUnusedLocals: true, noUnusedParameters: true,
      types: ['vite/client'] },
  }));
  const typescript = await command('pnpm', ['exec', 'tsc', '--project', benchmarkConfig, '--noEmit', '--pretty', 'false'], workDir, home, 120000);
  const typePass = typescript.exitCode === 0 && !typescript.timedOut && !typescript.error;
  const typeStatus = typescript.error || typescript.timedOut || typescript.exitCode !== 0 && !/error TS\d+/.test(typescript.output ?? '')
    ? 'error' : typePass ? 'pass' : 'fail';
  let eslint;
  try {
    const engine = new ESLint({
      cwd: workDir,
      overrideConfigFile: true,
      overrideConfig: [
        ...tseslint.configs.recommended,
        { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/reference/**', '**/evaluation/**', '**/.*/**'] },
      ],
      errorOnUnmatchedPattern: false,
    });
    const results = await engine.lintFiles(['**/*.{js,jsx,ts,tsx}']);
    const files = results.filter((item) => !item.ignored);
    const diagnostics = files.flatMap((item) => item.messages.map((message) => ({
      file: path.relative(workDir, item.filePath), line: message.line ?? null,
      rule: message.ruleId, severity: message.severity, message: message.message,
    })));
    eslint = { status: files.length ? diagnostics.every((item) => item.severity < 2) ? 'pass' : 'fail' : 'not_evaluated',
      pass: files.length > 0 && diagnostics.every((item) => item.severity < 2),
      files: files.length, errorCount: diagnostics.filter((item) => item.severity === 2).length,
      warningCount: diagnostics.filter((item) => item.severity === 1).length,
      diagnostics: diagnostics.slice(0, 100), truncated: diagnostics.length > 100 };
  } catch (error) { eslint = { status: 'error', pass: false, error: error.message }; }
  const complete = ['pass', 'fail'].includes(typeStatus) && ['pass', 'fail'].includes(eslint.status);
  return { version: staticEvaluatorVersion, tools: staticToolVersions,
    typescript: { status: typeStatus, pass: typePass, command: typescript }, eslint,
    score: complete ? 50 * Number(typePass) + 50 * Number(eslint.pass) : null };
}
