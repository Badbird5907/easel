import { CameraView } from 'expo-camera';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { useSyncExternalStore } from 'react';

import type { LocalFile } from '@/canvas/uploads';
import { pickPhotos, takePhoto, timestampName } from '@/features/files/upload';

/**
 * Document scanning for submissions (ASSIGN-4): capture pages, review and
 * reorder them, then combine them into one PDF with expo-print.
 *
 * Pages are captured with the system document scanner when the device has one
 * (VisionKit on iOS, ML Kit on Android: edge detection and perspective
 * correction), otherwise with the camera, or picked from Photos. Like uploads,
 * the pages live at module level, so leaving the screen keeps them.
 */

export type ScanPage = { id: string; uri: string };

const scans = new Map<string, ScanPage[]>();
const listeners = new Set<() => void>();
const EMPTY: ScanPage[] = [];
let nextId = 1;

function set(key: string, pages: ScanPage[]) {
  if (pages.length) scans.set(key, pages);
  else scans.delete(key);
  for (const listener of listeners) listener();
}

export const pagesFor = (key: string) => scans.get(key) ?? EMPTY;

export function useScanPages(key: string): ScanPage[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => pagesFor(key),
    () => pagesFor(key),
  );
}

export function addPages(key: string, uris: string[]) {
  set(key, [...pagesFor(key), ...uris.map((uri) => ({ id: `page-${nextId++}`, uri }))]);
}

export function removePage(key: string, id: string) {
  set(
    key,
    pagesFor(key).filter((p) => p.id !== id),
  );
}

export function movePage(key: string, id: string, offset: -1 | 1) {
  const pages = [...pagesFor(key)];
  const index = pages.findIndex((p) => p.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= pages.length) return;
  [pages[index], pages[target]] = [pages[target], pages[index]];
  set(key, pages);
}

export function clearPages(key: string) {
  set(key, []);
}

/** Whether this device has the system document scanner. Simulators don't. */
export const hasDocumentScanner = (() => {
  try {
    return CameraView.isDocumentScannerAvailable === true;
  } catch {
    return false;
  }
})();

/** Captures one or more pages. Resolves to the new page images, or none if canceled. */
export async function capturePages(): Promise<string[]> {
  if (hasDocumentScanner) {
    const result = await CameraView.scanDocumentAsync({ quality: 0.8 });
    return result?.pages ?? [];
  }
  const photo = await takePhoto();
  return photo ? [photo.uri] : [];
}

export async function pickPages(): Promise<string[]> {
  const photos = await pickPhotos({ multiple: true });
  return photos.map((p) => p.uri);
}

/** US Letter in points. Each scanned page is centered on one sheet. */
const PAGE = { width: 612, height: 792 };

/** Combines the pages, in order, into one PDF in the cache directory. */
export async function buildPdf(pages: ScanPage[]): Promise<LocalFile> {
  const images = await Promise.all(
    pages.map(async (page) => {
      const file = new File(page.uri);
      const base64 = await file.base64();
      const type = /\.png$/i.test(page.uri) ? 'image/png' : 'image/jpeg';
      return `data:${type};base64,${base64}`;
    }),
  );
  // The print renderer lays out at its own scale, so pages are sized in viewport units,
  // which match one sheet, rather than in points.
  const html = `<!doctype html><html><head><meta charset="utf-8" />
    <style>
      @page { size: ${PAGE.width}pt ${PAGE.height}pt; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; }
      .page { width: 100vw; height: 100vh; box-sizing: border-box; padding: 3vw;
        display: flex; align-items: center; justify-content: center; overflow: hidden;
        page-break-after: always; break-after: page; }
      .page:last-child { page-break-after: auto; break-after: auto; }
      img { max-width: 100%; max-height: 100%; object-fit: contain; }
    </style></head><body>
    ${images.map((src) => `<div class="page"><img src="${src}" /></div>`).join('')}
  </body></html>`;

  const result = await Print.printToFileAsync({
    html,
    width: PAGE.width,
    height: PAGE.height,
    margins: { left: 0, right: 0, top: 0, bottom: 0 },
  });

  const name = timestampName('Scan', 'pdf');
  const printed = new File(result.uri);
  const destination = new File(Paths.cache, name);
  try {
    if (destination.exists) destination.delete();
    printed.moveSync(destination);
  } catch {
    // Keep the printed file under its generated name; Canvas still gets the readable display name.
    return { uri: printed.uri, name, size: printed.size ?? null, mimeType: 'application/pdf' };
  }
  return { uri: destination.uri, name, size: destination.size ?? null, mimeType: 'application/pdf' };
}
