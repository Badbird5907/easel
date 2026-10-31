import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';

import type { FileItem } from '@/canvas/api/files';
import type { CanvasClient } from '@/canvas/client';

import { FileActionError } from './actions';
import { describeFile } from './kinds';

/*
 * Print (FILE-11): PDFs print as they are, images and plain text print
 * through a page Easel lays out, and Office documents print from the PDF
 * Canvas's DocViewer makes of them, when the school has DocViewer.
 */

export type PrintKind = 'pdf' | 'image' | 'text' | 'rendition';

/** How a file prints, or null when it can't. */
export function printKind(file: FileItem): PrintKind | null {
  if (file.lockedForUser) return null;
  const { kind } = describeFile(file);
  if (kind === 'pdf') return 'pdf';
  if (kind === 'image' && !/svg/i.test(file.contentType)) return 'image';
  if (kind === 'text' || kind === 'code' || kind === 'markdown' || kind === 'csv') return 'text';
  if ((kind === 'document' || kind === 'spreadsheet' || kind === 'presentation') && file.previewUrl)
    return 'rendition';
  return null;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function page(title: string, body: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>@page{margin:0.6in}body{margin:0;font:11pt -apple-system,Roboto,sans-serif;color:#000}
img{display:block;max-width:100%;max-height:9.5in;margin:0 auto;object-fit:contain}
pre{white-space:pre-wrap;word-wrap:break-word;font:10pt ui-monospace,Menlo,monospace}</style></head>
<body>${body}</body></html>`;
}

function mimeOf(file: FileItem) {
  return file.contentType || `image/${describeFile(file).label.toLowerCase()}`;
}

/** Opens the system print dialog. Resolves quietly when the student cancels. */
async function printWith(options: Print.PrintOptions) {
  try {
    await Print.printAsync(options);
  } catch (error) {
    if (/cancel/i.test(String((error as Error)?.message))) return;
    throw new FileActionError(
      'Couldn’t open printing. Try again, or share the file to another app to print it.',
      { reason: 'print-open' },
    );
  }
}

/**
 * The PDF DocViewer made of a document. The session URL redirects to the
 * viewer; its metadata names the PDF (canvas-ios DocViewerSession does the same).
 */
async function renditionPdf(client: CanvasClient, file: FileItem): Promise<File> {
  const fail = () =>
    new FileActionError(
      'Canvas couldn’t make a printable copy of this document. Open it in another app to print it.',
      { reason: 'print-rendition' },
    );
  if (!file.previewUrl) throw fail();
  const sameHost = (() => {
    try {
      return new URL(file.previewUrl).host === new URL(client.baseUrl).host;
    } catch {
      return false;
    }
  })();
  const viewer = await fetch(file.previewUrl, { headers: sameHost ? client.authHeaders : undefined });
  if (!viewer.ok) throw fail();
  const session = new URL(viewer.url);
  session.search = '';
  session.pathname = session.pathname.replace(/\/view\/?$/, '');
  const sessionUrl = session.toString();

  let metadata: { urls?: { pdf_download?: string } } | null = null;
  // DocViewer answers 202 while it's still converting.
  for (let attempt = 0; attempt < 6 && !metadata; attempt += 1) {
    const response = await fetch(sessionUrl, { headers: { Accept: 'application/json' } });
    if (response.status === 202) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      continue;
    }
    if (!response.ok) throw fail();
    metadata = await response.json();
  }
  const download = metadata?.urls?.pdf_download;
  if (!download) throw fail();
  const target = new File(Paths.cache, `print-${file.id}-${Date.now()}.pdf`);
  try {
    return await File.downloadFileAsync(new URL(download, sessionUrl).toString(), target, {
      idempotent: true,
    });
  } catch {
    throw fail();
  }
}

/**
 * Prints a file. `local` downloads it first when needed (the viewer's shared
 * download, so a file already on screen isn't fetched twice).
 */
export async function printFile(client: CanvasClient, file: FileItem, local: () => Promise<File | null>) {
  const kind = printKind(file);
  if (!kind)
    throw new FileActionError(
      'This kind of file can’t be printed from Easel. Open it in another app to print it.',
      { reason: 'print-unsupported' },
    );
  if (kind === 'rendition') {
    const pdf = await renditionPdf(client, file);
    try {
      await printWith({ uri: pdf.uri });
    } finally {
      try {
        pdf.delete();
      } catch {
        // Cache cleanup is best effort.
      }
    }
    return;
  }
  const copy = await local();
  if (!copy) return;
  if (kind === 'pdf') {
    await printWith({ uri: copy.uri });
  } else if (kind === 'image') {
    const data = await copy.base64();
    await printWith({ html: page(file.name, `<img src="data:${mimeOf(file)};base64,${data}" alt="">`) });
  } else {
    const text = await copy.text();
    await printWith({ html: page(file.name, `<pre>${escapeHtml(text)}</pre>`) });
  }
}
