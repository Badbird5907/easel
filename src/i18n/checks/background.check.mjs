/** Node integration harness. No actual native storage, notifications, widgets or UI. */
import { build } from 'esbuild';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, '../../..'),
  stub = resolve(here, 'background.stubs.mjs');
const out = mkdtempSync(resolve(tmpdir(), 'easel-background-'));
try {
  await build({
    entryPoints: [resolve(here, 'background.cases.mjs')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: resolve(out, 'check.mjs'),
    tsconfig: resolve(root, 'tsconfig.json'),
    plugins: [
      {
        name: 'native-boundaries',
        setup(b) {
          b.onResolve(
            { filter: /^(react-native|expo-notifications|@\/canvas\/session|@\/canvas\/query)$/ },
            () => ({ path: stub }),
          );
          b.onResolve({ filter: /^(\.\/kv|\.\/layouts)$/ }, () => ({ path: stub }));
          b.onResolve({ filter: /^\.\.\/(query|session|uploads)$/ }, (a) =>
            a.importer.endsWith('/api/profile.ts') ? { path: stub } : null,
          );
          b.onResolve(
            { filter: /^@\/canvas\/api\/(notifications|planner|courses|grades|announcements)$/ },
            (a) => (/\/(check|publish)\.ts$/.test(a.importer) ? { path: stub } : null),
          );
          b.onResolve({ filter: /^@\/features\/notifications\/platform$|^\.\/platform$/ }, () => ({
            path: stub,
          }));
          b.onLoad({ filter: /widgets\/publish.ts$/ }, (a) => ({
            contents: readFileSync(a.path, 'utf8').replace("from 'react';", `from '${stub}';`),
            loader: 'ts',
          }));
        },
      },
    ],
  });
  await import(pathToFileURL(resolve(out, 'check.mjs')).href);
} finally {
  rmSync(out, { recursive: true, force: true });
}
