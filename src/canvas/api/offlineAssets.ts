import { fetch as expoFetch } from 'expo/fetch';

import type { CanvasClient } from '../client';

/** Only inert raster images, finite media files and captions. Never HTML/SVG/manifests. */
export function offlineAssetMime(type: string): string | null {
  const mime = type.split(';')[0].trim().toLowerCase();
  return /^(?:image\/(?:png|jpeg|gif|webp|avif|bmp)|audio\/(?:mpeg|mp4|aac|ogg|wav|x-wav|webm)|video\/(?:mp4|webm|ogg|quicktime)|text\/vtt)$/.test(
    mime,
  )
    ? mime
    : null;
}

/**
 * Explicit redirect handling is supported by Expo 58's native fetch on both platforms.
 * Only the initial same-origin request may carry Canvas credentials. After leaving
 * that origin they are never reattached, even if redirected back. No ambient cookies.
 * Attachment API URLs are emitted by Canvas's lib/api/v1/attachment.rb; HTML URLs
 * may be arbitrary external resources, so no authentication is inferred from them.
 */
export async function fetchOfflineAsset(
  client: CanvasClient,
  raw: string,
  signal: AbortSignal,
  limit: number,
  request: typeof expoFetch = expoFetch,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const timeout = setTimeout(cancel, 30_000);
  try {
    return await download(client, raw, controller.signal, limit, request);
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted) throw new Error('Asset download timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}

async function download(
  client: CanvasClient,
  raw: string,
  signal: AbortSignal,
  limit: number,
  request: typeof expoFetch,
) {
  let url = new URL(raw);
  const origin = new URL(client.baseUrl).origin;
  let authorized = url.origin === origin;
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (signal.aborted) throw Object.assign(new Error('Sync cancelled'), { name: 'AbortError' });
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.origin === origin))
    )
      throw new Error('Unsupported asset URL');
    const response = await request(url.href, {
      headers: authorized ? client.authHeaders : {},
      signal,
      redirect: 'manual',
      credentials: 'omit',
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('Asset redirect unavailable');
      url = new URL(location, url);
      authorized &&= url.origin === origin;
      continue;
    }
    const mime = offlineAssetMime(response.headers.get('content-type') ?? '');
    if (!response.ok || !mime || Number(response.headers.get('content-length') ?? 0) > limit) {
      await response.body?.cancel();
      throw new Error('Asset unavailable, unsupported, or too large');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Streaming download unavailable');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        if (signal.aborted) throw Object.assign(new Error('Sync cancelled'), { name: 'AbortError' });
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error('Asset too large');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (!size) throw new Error('Empty asset');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return { bytes, mime };
  }
  throw new Error('Too many asset redirects');
}
