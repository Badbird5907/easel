/**
 * Fake Canvas for development and tests. No dependencies.
 *
 *   pnpm run fake-canvas          # http://localhost:3030, token "dev"
 *
 * Every file in ./routes exports `routes`: [{ method, path, handler, public? }].
 * `path` uses :params (e.g. /api/v1/courses/:courseId). A handler receives
 * { params, query, body, req, url } and returns { status?, body, headers? } or a plain body.
 * Response shapes follow canvas-lms serializers; keep them honest.
 *
 * Route files reload when they change, so endpoints can be added while the
 * server runs. Files load alphabetically and the first matching route wins.
 */
import { createServer } from 'node:http';
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { authenticate } from './tokens.mjs';

const PORT = Number(process.env.PORT ?? 3030);
const TOKEN = process.env.FAKE_CANVAS_TOKEN ?? 'dev';
const here = dirname(fileURLToPath(import.meta.url));
const routesDir = join(here, 'routes');

let table = [];
let signature = '';

function compile(path) {
  const keys = [];
  const source = path.replace(/:(\w+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { pattern: new RegExp(`^${source}/?$`), keys };
}

async function loadRoutes() {
  const files = (await readdir(routesDir)).filter((f) => f.endsWith('.mjs')).sort();
  const stats = await Promise.all(files.map((f) => stat(join(routesDir, f))));
  const next = files.map((f, i) => `${f}:${stats[i].mtimeMs}`).join('|');
  if (next === signature) return;
  const fresh = [];
  for (const [i, file] of files.entries()) {
    try {
      const mod = await import(`${pathToFileURL(join(routesDir, file)).href}?v=${stats[i].mtimeMs}`);
      for (const route of mod.routes ?? []) {
        fresh.push({ ...route, method: route.method ?? 'GET', ...compile(route.path), file });
      }
    } catch (error) {
      console.error(`Couldn't load routes/${file}: ${error.message}`);
    }
  }
  table = fresh;
  signature = next;
  console.log(`Loaded ${table.length} routes from ${files.length} files`);
}

/** Parses `a[]=1&a[]=2&b=3` the way Rails does for the shapes Easel sends. */
function parseQuery(searchParams) {
  const query = {};
  for (const [rawKey, value] of searchParams) {
    if (rawKey.endsWith('[]')) (query[rawKey.slice(0, -2)] ??= []).push(value);
    else query[rawKey] = value;
  }
  return query;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) return undefined;
  const type = req.headers['content-type'] ?? '';
  if (type.includes('application/json')) {
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch {
      return undefined;
    }
  }
  if (type.includes('application/x-www-form-urlencoded'))
    return Object.fromEntries(new URLSearchParams(buffer.toString('utf8')));
  return buffer;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const started = Date.now();
  const send = (status, body, headers = {}) => {
    const raw = Buffer.isBuffer(body) || typeof body === 'string';
    res.writeHead(status, {
      'Content-Type': raw ? 'application/octet-stream' : 'application/json; charset=utf-8',
      ...headers,
    });
    res.end(raw ? body : JSON.stringify(body));
    console.log(`${req.method} ${url.pathname}${url.search} -> ${status} (${Date.now() - started}ms)`);
  };

  await loadRoutes();
  const route = table.find((r) => r.method === req.method && r.pattern.test(url.pathname));
  if (!route) return send(404, { errors: [{ message: 'The specified resource does not exist.' }] });

  // Public routes (file downloads with verifiers, session pages) opt out of token auth.
  // Accepts the "dev" token and OAuth tokens issued by routes/auth.mjs (see tokens.mjs).
  if (!route.public) {
    const auth = authenticate(req.headers.authorization, TOKEN);
    if (!auth.ok) return send(401, { errors: [{ message: auth.message }] }, { 'WWW-Authenticate': 'Bearer realm="canvas-lms"' });
  }

  const match = url.pathname.match(route.pattern);
  const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
  try {
    const result = await route.handler({
      params,
      query: parseQuery(url.searchParams),
      body: await readBody(req),
      req,
      url,
    });
    if (
      result &&
      typeof result === 'object' &&
      !Array.isArray(result) &&
      'body' in result &&
      ('status' in result || 'headers' in result)
    ) {
      send(result.status ?? 200, result.body, result.headers);
    } else {
      send(200, result ?? null);
    }
  } catch (error) {
    console.error(error);
    send(500, { errors: [{ message: String(error.message ?? error) }] });
  }
});

await loadRoutes();
server.listen(PORT, () => {
  console.log(`Fake Canvas on http://localhost:${PORT} (token "${TOKEN}")`);
});
