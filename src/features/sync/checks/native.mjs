// Explicit in-memory native adapters. HTTP requests still use real local fake Canvas.
import { Buffer } from 'node:buffer';
const files = new Map();
const dirs = new Set();
const path = (...parts) =>
  parts
    .map((p) => (typeof p === 'string' ? p : p.uri))
    .join('/')
    .replace(/\/{2,}/g, '/');
export const Paths = { document: '/document', cache: '/cache' };
export let snapshotWrite = null;
export const onSnapshotWrite = (fn) => {
  snapshotWrite = fn;
};
export let downloadGate = null;
export const gateDownloads = (fn) => {
  downloadGate = fn;
};
export const diskPaths = () => [...files.keys()];
export class Directory {
  constructor(...parts) {
    this.uri = path(...parts);
  }
  get name() {
    return this.uri.split('/').pop();
  }
  get exists() {
    return dirs.has(this.uri);
  }
  create() {
    let current = '';
    for (const part of this.uri.split('/').filter(Boolean)) {
      current += '/' + part;
      dirs.add(current);
    }
  }
  get size() {
    return [...files].filter(([p]) => p.startsWith(this.uri + '/')).reduce((s, [, b]) => s + b.length, 0);
  }
  delete() {
    for (const p of files.keys()) if (p.startsWith(this.uri + '/')) files.delete(p);
    for (const p of dirs) if (p === this.uri || p.startsWith(this.uri + '/')) dirs.delete(p);
  }
  list() {
    const prefix = this.uri + '/';
    return [
      ...[...dirs]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => new Directory(p)),
      ...[...files.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => new File(p)),
    ];
  }
}
export class File {
  constructor(...parts) {
    this.uri = path(...parts);
  }
  get exists() {
    return files.has(this.uri);
  }
  get name() {
    return this.uri.split('/').pop();
  }
  get size() {
    return files.get(this.uri)?.length ?? 0;
  }
  get parentDirectory() {
    return new Directory(this.uri.slice(0, this.uri.lastIndexOf('/')));
  }
  writeSync(value) {
    if (!this.parentDirectory.exists) throw Error('Directory missing');
    files.set(this.uri, Buffer.from(value));
    if (this.uri.includes('easel-sync')) snapshotWrite?.();
  }
  textSync() {
    return files.get(this.uri).toString();
  }
  bytesSync() {
    return new Uint8Array(files.get(this.uri));
  }
  base64Sync() {
    return files.get(this.uri).toString('base64');
  }
  delete() {
    files.delete(this.uri);
  }
  moveSync(to) {
    to.writeSync(this.bytesSync());
    this.delete();
  }
  open() {
    return { readBytes: (n) => this.bytesSync().slice(0, n), close() {} };
  }
  static createDownloadTask(url, partial, options) {
    return {
      downloadAsync: async () => {
        // Deliberately ignore cancellation, exercising late native download completion.
        await downloadGate?.();
        const response = await globalThis.fetch(url, { headers: options.headers });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        partial.parentDirectory.create();
        partial.writeSync(bytes);
        options.onProgress?.({ bytesWritten: bytes.length, totalBytes: bytes.length });
        return partial;
      },
    };
  }
}
export const FileMode = { ReadOnly: 0 };
const kv = new Map();
export const offlineKv = {
  getItemSync: (k) => kv.get(k),
  setItemSync: (k, v) => kv.set(k, v),
  removeItemSync: (k) => kv.delete(k),
};
export const cleanups = [];
export const registerAccountCleanup = (fn) => {
  cleanups.push(fn);
  return () => {};
};
export const cleanupAccount = (id) => Promise.all(cleanups.map((fn) => fn(id)));
let storedClients = [];
export const setStoredClients = (clients) => { storedClients = clients; };
export const loadStoredClients = async () => storedClients;
export const useSession = () => ({ status: 'ready' });
export const useCanvas = () => ({});
export const useCanvasQuery = () => ({});
export const useCanvasMutation = () => ({});
export const useAccountKey = () => '';
export const AppState = { addEventListener: () => ({ remove() {} }) };
export const Platform = { OS: 'ios' };
export const NetworkStateType = { WIFI: 'wifi', ETHERNET: 'ethernet' };
export const getNetworkStateAsync = async () => ({ type: 'wifi' });
export const isOnline = () => true;
export const sessionUrl = async (_client, url) => url;
export const fetch = (...args) => globalThis.fetch(...args);
export const describeFile = (f) => ({
  kind: f.contentType?.startsWith('video/')
    ? 'video'
    : f.contentType?.startsWith('audio/')
      ? 'audio'
      : 'other',
});
export const extensionFor = (f) => f.filename?.split('.').pop() ?? '';
export default { expoConfig: { version: 'test' }, nativeBuildVersion: 'test' };
