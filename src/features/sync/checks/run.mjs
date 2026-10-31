// Run from easel: node src/features/sync/checks/run.mjs (fake Canvas on localhost:3030).
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../../../..');
const out = await mkdtemp(join(tmpdir(), 'easel-sync-check-'));
try {
  await build({
    entryPoints: [join(here, 'cases.mjs')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(out, 'checks.mjs'),
    absWorkingDir: root,
    plugins: [
      {
        name: 'native-adapters',
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(expo-file-system|expo\/fetch|expo-constants|expo-network|react-native|@\/canvas\/session|\.\.\/session|\.\.\/query|@\/features\/offline\/connectivity|\.\/kv|@\/features\/content\/browser)$/,
            },
            () => ({ path: join(here, 'native.mjs') }),
          );
          b.onResolve({ filter: /^\.\/kinds$/ }, (args) =>
            args.importer.endsWith('/files/download.ts') ? { path: join(here, 'native.mjs') } : null,
          );
          b.onResolve({ filter: /^@\/features\/files\/kinds$/ }, () => ({ path: join(here, 'native.mjs') }));
        },
      },
    ],
  });
  await import(pathToFileURL(join(out, 'checks.mjs')));
} finally {
  await rm(out, { recursive: true, force: true });
}
