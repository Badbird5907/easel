import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
async function discover(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory()
          ? discover(file)
          : /\.check\.(?:cjs|mjs|ts)$/.test(entry.name)
            ? [file]
            : [];
      }),
    )
  ).flat();
}
const files = (await discover(path.join(root, 'src'))).sort();
const concurrency = Math.min(4, availableParallelism());
const started = Date.now();
const failures = [];
let next = 0;
async function worker() {
  while (next < files.length) {
    const file = files[next++];
    const relative = path.relative(root, file);
    const result = await new Promise((resolve) => {
      // TS and ESM checks import production TypeScript directly. CJS checks own their transpilers.
      const args = file.endsWith('.cjs') ? [file] : ['--import', 'tsx', file];
      const child = spawn(process.execPath, args, { cwd: root, env: process.env });
      const timeout = setTimeout(() => {
        output += '\nError: Check exceeded 60 seconds\n';
        child.kill('SIGKILL');
      }, 60_000);
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      child.on('error', (error) => resolve({ code: 1, output: error.stack }));
      child.on('close', (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, output, signal });
      });
    });
    if (result.code === 0) console.log(`PASS ${relative}`);
    else {
      const lines = result.output.trim().split('\n');
      const error =
        lines.find((line) => /^(?:[A-Za-z]*Error(?: \[.*?\])?:|FAIL)/.test(line)) ||
        lines.find((line) => line.trim()) ||
        `Exited ${result.code} (${result.signal ?? 'no diagnostic output'})`;
      failures.push({ file: relative, error, output: result.output });
      console.log(`FAIL ${relative}: ${error}`);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
for (const failure of failures)
  console.error(`\n--- ${failure.file} ---\n${failure.output || failure.error}`);
console.log(
  `\n${files.length - failures.length}/${files.length} checks passed; ${failures.length} failed (${((Date.now() - started) / 1000).toFixed(1)}s, concurrency ${concurrency})`,
);
process.exitCode = failures.length ? 1 : 0;
