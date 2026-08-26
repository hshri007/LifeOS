/**
 * One-command dev launcher: starts the API (:4000) and the web app (:5173)
 * together, prefixes their logs and shuts both down on Ctrl-C.
 *
 * Usage: npm run dev
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const procs = [];

function start(name, cwd, command, args) {
  const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${name}] `;
  const pipe = (stream, out) =>
    stream.on('data', (chunk) => out.write(String(chunk).split('\n').map((l) => (l ? tag + l : l)).join('\n')));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => console.log(`${tag}exited (${code ?? 'signal'})`));
  procs.push(child);
}

start('api', path.join(ROOT, 'services/api'), 'npx', ['tsx', 'watch', 'src/index.ts']);
start('web', path.join(ROOT, 'apps/web'), 'npx', ['vite', '--port', '5173', '--strictPort']);

function shutdown() {
  for (const p of procs) {
    try { p.kill('SIGTERM'); } catch { /* already gone */ }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('\nLifeOS dev running:');
console.log('  • Web app  → http://localhost:5173');
console.log('  • API      → http://localhost:4000/api/health');
console.log('  Press Ctrl-C to stop both.\n');
