import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export function check(id, status, evidence) { return { id, status, evidence }; }

export async function command(commandName, args, cwd, home, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(commandName, args, {
      cwd, env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, CI: '1', COREPACK_ENABLE_AUTO_PIN: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    let error = null;
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => { output = (output + chunk.toString()).slice(-4000); });
    }
    child.on('error', (cause) => { error = cause.message; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ command: [commandName, ...args].join(' '), exitCode, timedOut, durationMs: Date.now() - started, output, error });
    });
  });
}

function major(value) {
  const match = String(value ?? '').match(/(?:^|[^\d])(\d+)(?:\.|$)/);
  return match ? Number(match[1]) : null;
}

export async function technicalStack(workDir, prefix) {
  const manifest = JSON.parse(await fs.readFile(path.join(workDir, 'package.json'), 'utf8'));
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  const observed = { react: deps.react, typescript: deps.typescript, vite: deps.vite, tailwindcss: deps.tailwindcss, packageManager: manifest.packageManager };
  const correct = major(deps.react) === 19 && Boolean(deps.typescript) && Boolean(deps.vite)
    && major(deps.tailwindcss) === 4 && /^pnpm@/.test(manifest.packageManager ?? '');
  const lock = await fs.stat(path.join(workDir, 'pnpm-lock.yaml')).then(() => true, () => false);
  const npmLock = await fs.stat(path.join(workDir, 'package-lock.json')).then(() => true, () => false);
  const yarnLock = await fs.stat(path.join(workDir, 'yarn.lock')).then(() => true, () => false);
  return check(`${prefix}-T01`, correct && lock && !npmLock && !yarnLock ? 'pass' : 'fail', { observed, pnpmLock: lock, npmLock, yarnLock });
}

export async function serve(directory) {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(`${path.resolve(directory)}${path.sep}`)) { response.writeHead(403).end(); return; }
      const data = await fs.readFile(file);
      response.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream' }).end(data);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
