import {
  File as FileIcon,
  FileArchive,
  FileCode,
  FileHeadphone,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideoCamera,
  Globe,
  type LucideIcon,
  Presentation,
} from 'lucide-react-native';

import { createTranslator, normalizeLocale } from '@/i18n/runtime';
import type { MessageKey } from '@/i18n/types';
import { type DateContext, formatDate, formatShortDate } from '@/lib/dates';

/**
 * What a file is, in words a student reads ("Word document", "MP4 video"). MIME
 * strings never reach the UI; they only inform these decisions.
 */

export type FileKind =
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'code'
  | 'csv'
  | 'markdown'
  | 'html'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'other';

type TypeInfo = {
  kind: FileKind;
  label: string;
  descriptionKey: Extract<MessageKey, `file.type.${string}`>;
  /** Canonical MIME type, for share intents when Canvas stored a generic one. */
  mime: string;
  /** iOS Uniform Type Identifier and the extension iOS prefers for it. */
  uti?: string;
};

const byExtension: Record<string, TypeInfo> = {
  pdf: {
    descriptionKey: 'file.type.pdf',
    kind: 'pdf',
    label: 'PDF',
    mime: 'application/pdf',
    uti: 'com.adobe.pdf',
  },

  doc: {
    descriptionKey: 'file.type.doc',
    kind: 'document',
    label: 'Word document',
    mime: 'application/msword',
    uti: 'com.microsoft.word.doc',
  },
  docx: {
    descriptionKey: 'file.type.docx',
    kind: 'document',
    label: 'Word document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    uti: 'org.openxmlformats.wordprocessingml.document',
  },
  dotx: {
    descriptionKey: 'file.type.dotx',
    kind: 'document',
    label: 'Word template',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  },
  odt: {
    descriptionKey: 'file.type.odt',
    kind: 'document',
    label: 'OpenDocument text',
    mime: 'application/vnd.oasis.opendocument.text',
  },
  rtf: {
    descriptionKey: 'file.type.rtf',
    kind: 'document',
    label: 'Rich Text document',
    mime: 'application/rtf',
    uti: 'public.rtf',
  },
  pages: {
    descriptionKey: 'file.type.pages',
    kind: 'document',
    label: 'Pages document',
    mime: 'application/vnd.apple.pages',
    uti: 'com.apple.iwork.pages.sffpages',
  },
  epub: {
    descriptionKey: 'file.type.epub',
    kind: 'document',
    label: 'EPUB book',
    mime: 'application/epub+zip',
    uti: 'org.idpf.epub-container',
  },

  xls: {
    descriptionKey: 'file.type.xls',
    kind: 'spreadsheet',
    label: 'Excel spreadsheet',
    mime: 'application/vnd.ms-excel',
    uti: 'com.microsoft.excel.xls',
  },
  xlsx: {
    descriptionKey: 'file.type.xlsx',
    kind: 'spreadsheet',
    label: 'Excel spreadsheet',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    uti: 'org.openxmlformats.spreadsheetml.sheet',
  },
  ods: {
    descriptionKey: 'file.type.ods',
    kind: 'spreadsheet',
    label: 'OpenDocument spreadsheet',
    mime: 'application/vnd.oasis.opendocument.spreadsheet',
  },
  numbers: {
    descriptionKey: 'file.type.numbers',
    kind: 'spreadsheet',
    label: 'Numbers spreadsheet',
    mime: 'application/vnd.apple.numbers',
    uti: 'com.apple.iwork.numbers.sffnumbers',
  },

  ppt: {
    descriptionKey: 'file.type.ppt',
    kind: 'presentation',
    label: 'PowerPoint presentation',
    mime: 'application/vnd.ms-powerpoint',
    uti: 'com.microsoft.powerpoint.ppt',
  },
  pptx: {
    descriptionKey: 'file.type.pptx',
    kind: 'presentation',
    label: 'PowerPoint presentation',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    uti: 'org.openxmlformats.presentationml.presentation',
  },
  odp: {
    descriptionKey: 'file.type.odp',
    kind: 'presentation',
    label: 'OpenDocument presentation',
    mime: 'application/vnd.oasis.opendocument.presentation',
  },
  key: {
    descriptionKey: 'file.type.key',
    kind: 'presentation',
    label: 'Keynote presentation',
    mime: 'application/vnd.apple.keynote',
    uti: 'com.apple.iwork.keynote.sffkey',
  },

  txt: {
    descriptionKey: 'file.type.txt',
    kind: 'text',
    label: 'Text file',
    mime: 'text/plain',
    uti: 'public.plain-text',
  },
  log: { descriptionKey: 'file.type.log', kind: 'text', label: 'Log file', mime: 'text/plain' },
  csv: {
    descriptionKey: 'file.type.csv',
    kind: 'csv',
    label: 'CSV spreadsheet',
    mime: 'text/csv',
    uti: 'public.comma-separated-values-text',
  },
  tsv: {
    descriptionKey: 'file.type.tsv',
    kind: 'csv',
    label: 'TSV spreadsheet',
    mime: 'text/tab-separated-values',
    uti: 'public.tab-separated-values-text',
  },
  md: {
    descriptionKey: 'file.type.md',
    kind: 'markdown',
    label: 'Markdown document',
    mime: 'text/markdown',
    uti: 'net.daringfireball.markdown',
  },
  markdown: {
    descriptionKey: 'file.type.markdown',
    kind: 'markdown',
    label: 'Markdown document',
    mime: 'text/markdown',
  },
  html: {
    descriptionKey: 'file.type.html',
    kind: 'html',
    label: 'Web page',
    mime: 'text/html',
    uti: 'public.html',
  },
  htm: { descriptionKey: 'file.type.htm', kind: 'html', label: 'Web page', mime: 'text/html' },

  json: {
    descriptionKey: 'file.type.json',
    kind: 'code',
    label: 'JSON file',
    mime: 'application/json',
    uti: 'public.json',
  },
  xml: {
    descriptionKey: 'file.type.xml',
    kind: 'code',
    label: 'XML file',
    mime: 'application/xml',
    uti: 'public.xml',
  },
  yaml: { descriptionKey: 'file.type.yaml', kind: 'code', label: 'YAML file', mime: 'application/yaml' },
  yml: { descriptionKey: 'file.type.yml', kind: 'code', label: 'YAML file', mime: 'application/yaml' },
  py: {
    descriptionKey: 'file.type.py',
    kind: 'code',
    label: 'Python file',
    mime: 'text/x-python',
    uti: 'public.python-script',
  },
  ipynb: {
    descriptionKey: 'file.type.ipynb',
    kind: 'code',
    label: 'Jupyter notebook',
    mime: 'application/x-ipynb+json',
  },
  js: {
    descriptionKey: 'file.type.js',
    kind: 'code',
    label: 'JavaScript file',
    mime: 'text/javascript',
    uti: 'com.netscape.javascript-source',
  },
  ts: { descriptionKey: 'file.type.ts', kind: 'code', label: 'TypeScript file', mime: 'text/plain' },
  java: {
    descriptionKey: 'file.type.java',
    kind: 'code',
    label: 'Java file',
    mime: 'text/x-java-source',
    uti: 'com.sun.java-source',
  },
  c: {
    descriptionKey: 'file.type.c',
    kind: 'code',
    label: 'C file',
    mime: 'text/x-c',
    uti: 'public.c-source',
  },
  h: {
    descriptionKey: 'file.type.h',
    kind: 'code',
    label: 'C header',
    mime: 'text/x-c',
    uti: 'public.c-header',
  },
  cpp: {
    descriptionKey: 'file.type.cpp',
    kind: 'code',
    label: 'C++ file',
    mime: 'text/x-c++',
    uti: 'public.c-plus-plus-source',
  },
  cc: { descriptionKey: 'file.type.cc', kind: 'code', label: 'C++ file', mime: 'text/x-c++' },
  hpp: { descriptionKey: 'file.type.hpp', kind: 'code', label: 'C++ header', mime: 'text/x-c++' },
  cs: { descriptionKey: 'file.type.cs', kind: 'code', label: 'C# file', mime: 'text/plain' },
  go: { descriptionKey: 'file.type.go', kind: 'code', label: 'Go file', mime: 'text/plain' },
  rb: {
    descriptionKey: 'file.type.rb',
    kind: 'code',
    label: 'Ruby file',
    mime: 'text/x-ruby',
    uti: 'public.ruby-script',
  },
  rs: { descriptionKey: 'file.type.rs', kind: 'code', label: 'Rust file', mime: 'text/plain' },
  swift: {
    descriptionKey: 'file.type.swift',
    kind: 'code',
    label: 'Swift file',
    mime: 'text/plain',
    uti: 'public.swift-source',
  },
  kt: { descriptionKey: 'file.type.kt', kind: 'code', label: 'Kotlin file', mime: 'text/plain' },
  r: { descriptionKey: 'file.type.r', kind: 'code', label: 'R script', mime: 'text/plain' },
  m: { descriptionKey: 'file.type.m', kind: 'code', label: 'MATLAB file', mime: 'text/plain' },
  sql: { descriptionKey: 'file.type.sql', kind: 'code', label: 'SQL file', mime: 'application/sql' },
  sh: {
    descriptionKey: 'file.type.sh',
    kind: 'code',
    label: 'Shell script',
    mime: 'application/x-sh',
    uti: 'public.shell-script',
  },
  css: {
    descriptionKey: 'file.type.css',
    kind: 'code',
    label: 'CSS file',
    mime: 'text/css',
    uti: 'public.css',
  },
  tex: { descriptionKey: 'file.type.tex', kind: 'code', label: 'LaTeX file', mime: 'application/x-tex' },

  jpg: {
    descriptionKey: 'file.type.jpg',
    kind: 'image',
    label: 'JPEG image',
    mime: 'image/jpeg',
    uti: 'public.jpeg',
  },
  jpeg: {
    descriptionKey: 'file.type.jpeg',
    kind: 'image',
    label: 'JPEG image',
    mime: 'image/jpeg',
    uti: 'public.jpeg',
  },
  png: {
    descriptionKey: 'file.type.png',
    kind: 'image',
    label: 'PNG image',
    mime: 'image/png',
    uti: 'public.png',
  },
  gif: {
    descriptionKey: 'file.type.gif',
    kind: 'image',
    label: 'GIF image',
    mime: 'image/gif',
    uti: 'com.compuserve.gif',
  },
  heic: {
    descriptionKey: 'file.type.heic',
    kind: 'image',
    label: 'HEIC image',
    mime: 'image/heic',
    uti: 'public.heic',
  },
  heif: {
    descriptionKey: 'file.type.heif',
    kind: 'image',
    label: 'HEIF image',
    mime: 'image/heif',
    uti: 'public.heif',
  },
  webp: {
    descriptionKey: 'file.type.webp',
    kind: 'image',
    label: 'WebP image',
    mime: 'image/webp',
    uti: 'org.webmproject.webp',
  },
  svg: {
    descriptionKey: 'file.type.svg',
    kind: 'image',
    label: 'SVG image',
    mime: 'image/svg+xml',
    uti: 'public.svg-image',
  },
  bmp: {
    descriptionKey: 'file.type.bmp',
    kind: 'image',
    label: 'BMP image',
    mime: 'image/bmp',
    uti: 'com.microsoft.bmp',
  },
  tif: {
    descriptionKey: 'file.type.tif',
    kind: 'image',
    label: 'TIFF image',
    mime: 'image/tiff',
    uti: 'public.tiff',
  },
  tiff: {
    descriptionKey: 'file.type.tiff',
    kind: 'image',
    label: 'TIFF image',
    mime: 'image/tiff',
    uti: 'public.tiff',
  },

  mp4: {
    descriptionKey: 'file.type.mp4',
    kind: 'video',
    label: 'MP4 video',
    mime: 'video/mp4',
    uti: 'public.mpeg-4',
  },
  m4v: {
    descriptionKey: 'file.type.m4v',
    kind: 'video',
    label: 'MP4 video',
    mime: 'video/x-m4v',
    uti: 'com.apple.m4v-video',
  },
  mov: {
    descriptionKey: 'file.type.mov',
    kind: 'video',
    label: 'QuickTime video',
    mime: 'video/quicktime',
    uti: 'com.apple.quicktime-movie',
  },
  webm: {
    descriptionKey: 'file.type.webm',
    kind: 'video',
    label: 'WebM video',
    mime: 'video/webm',
    uti: 'org.webmproject.webm',
  },
  mkv: { descriptionKey: 'file.type.mkv', kind: 'video', label: 'MKV video', mime: 'video/x-matroska' },
  avi: {
    descriptionKey: 'file.type.avi',
    kind: 'video',
    label: 'AVI video',
    mime: 'video/x-msvideo',
    uti: 'public.avi',
  },

  mp3: {
    descriptionKey: 'file.type.mp3',
    kind: 'audio',
    label: 'MP3 audio',
    mime: 'audio/mpeg',
    uti: 'public.mp3',
  },
  m4a: {
    descriptionKey: 'file.type.m4a',
    kind: 'audio',
    label: 'M4A audio',
    mime: 'audio/mp4',
    uti: 'com.apple.m4a-audio',
  },
  aac: {
    descriptionKey: 'file.type.aac',
    kind: 'audio',
    label: 'AAC audio',
    mime: 'audio/aac',
    uti: 'public.aac-audio',
  },
  wav: {
    descriptionKey: 'file.type.wav',
    kind: 'audio',
    label: 'WAV audio',
    mime: 'audio/wav',
    uti: 'com.microsoft.waveform-audio',
  },
  ogg: { descriptionKey: 'file.type.ogg', kind: 'audio', label: 'Ogg audio', mime: 'audio/ogg' },
  oga: { descriptionKey: 'file.type.oga', kind: 'audio', label: 'Ogg audio', mime: 'audio/ogg' },
  opus: { descriptionKey: 'file.type.opus', kind: 'audio', label: 'Opus audio', mime: 'audio/opus' },
  flac: { descriptionKey: 'file.type.flac', kind: 'audio', label: 'FLAC audio', mime: 'audio/flac' },

  zip: {
    descriptionKey: 'file.type.zip',
    kind: 'archive',
    label: 'ZIP archive',
    mime: 'application/zip',
    uti: 'public.zip-archive',
  },
  rar: {
    descriptionKey: 'file.type.rar',
    kind: 'archive',
    label: 'RAR archive',
    mime: 'application/vnd.rar',
  },
  '7z': {
    descriptionKey: 'file.type.7z',
    kind: 'archive',
    label: '7-Zip archive',
    mime: 'application/x-7z-compressed',
  },
  tar: {
    descriptionKey: 'file.type.tar',
    kind: 'archive',
    label: 'TAR archive',
    mime: 'application/x-tar',
    uti: 'public.tar-archive',
  },
  gz: {
    descriptionKey: 'file.type.gz',
    kind: 'archive',
    label: 'Gzip archive',
    mime: 'application/gzip',
    uti: 'org.gnu.gnu-zip-archive',
  },
  tgz: { descriptionKey: 'file.type.tgz', kind: 'archive', label: 'Gzip archive', mime: 'application/gzip' },
};

/** Extensions iOS prefers for a UTI; sharing appends this extension when it differs. */
const preferredExtension: Record<string, string> = {
  'public.jpeg': 'jpeg',
  'public.html': 'html',
  'public.mpeg-4': 'mp4',
  'public.plain-text': 'txt',
  'public.tiff': 'tiff',
};

/** MIME types Canvas stores, for files whose names lack an extension. */
const byMime: Record<string, string> = Object.fromEntries(
  Object.entries(byExtension)
    .reverse()
    .map(([ext, info]) => [info.mime, ext]),
);
Object.assign(byMime, {
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'audio/x-m4a': 'm4a',
  'audio/mp3': 'mp3',
  'audio/x-wav': 'wav',
  'application/x-zip-compressed': 'zip',
  'application/x-pdf': 'pdf',
  'text/x-markdown': 'md',
  'text/x-python-script': 'py',
  'application/x-python-code': 'py',
});

const kindIcons: Record<FileKind, LucideIcon> = {
  pdf: FileType,
  image: FileImage,
  video: FileVideoCamera,
  audio: FileHeadphone,
  text: FileText,
  code: FileCode,
  csv: FileSpreadsheet,
  markdown: FileText,
  html: Globe,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  archive: FileArchive,
  other: FileIcon,
};

export function extensionOf(name: string | null | undefined): string {
  const match = name?.match(/\.([A-Za-z0-9]{1,8})$/);
  return match ? match[1].toLowerCase() : '';
}

/** The extension that best describes a file: its name first, then its stored type. */
export function extensionFor(file: { name: string; filename?: string; contentType?: string }): string {
  const fromName = extensionOf(file.name) || extensionOf(file.filename);
  if (fromName) return fromName;
  const mime = file.contentType?.split(';')[0].trim().toLowerCase() ?? '';
  return Object.hasOwn(byMime, mime) ? byMime[mime] : '';
}

export type FileDescription = {
  kind: FileKind;
  /** "Word document", "PDF", "MP4 video". Never a MIME type. */
  label: string;
  icon: LucideIcon;
  extension: string;
  /** Best MIME type for share and open-in intents. */
  mimeType: string;
  uti: string | undefined;
  /** Whether iOS keeps the file's name as-is when shared with `uti`. */
  utiMatchesExtension: boolean;
};

function kindFromMime(mime: string): FileKind {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'text/html') return 'html';
  if (mime === 'text/csv') return 'csv';
  if (mime.startsWith('text/')) return 'text';
  return 'other';
}

const genericLabel: Partial<Record<FileKind, string>> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  text: 'Text file',
};

const genericDescription: Partial<Record<FileKind, Extract<MessageKey, `file.generic.${string}`>>> = {
  image: 'file.generic.image',
  video: 'file.generic.video',
  audio: 'file.generic.audio',
  text: 'file.generic.text',
};

/** Omit locale to retain legacy English labels, including for sharing consumers. */
export function describeFile(
  file: {
    name: string;
    filename?: string;
    contentType?: string;
  },
  locale?: string,
): FileDescription {
  const extension = extensionFor(file);
  const mime = file.contentType?.split(';')[0].trim().toLowerCase() ?? '';
  const known = Object.hasOwn(byExtension, extension) ? byExtension[extension] : undefined;
  // A generic stored type ("application/octet-stream") says less than the extension.
  const generic = !mime || mime === 'application/octet-stream' || mime === 'unknown/unknown';
  const kind = known?.kind ?? (generic ? 'other' : kindFromMime(mime));
  const legacyLabel =
    known?.label ?? genericLabel[kind] ?? (extension ? `${extension.toUpperCase()} file` : 'File');
  const t = locale === undefined ? undefined : createTranslator(locale);
  const genericKey = genericDescription[kind];
  const label = t
    ? known
      ? t(known.descriptionKey)
      : genericKey
        ? t(genericKey)
        : extension
          ? t('file.extension', { extension: extension.toUpperCase() })
          : t('file.generic.file')
    : legacyLabel;
  const uti = known?.uti;
  return {
    kind,
    label,
    icon: kindIcons[kind],
    extension,
    mimeType: generic ? (known?.mime ?? 'application/octet-stream') : mime,
    uti,
    utiMatchesExtension: !!uti && (preferredExtension[uti] ?? extension) === extension,
  };
}

const sizeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/** Decimal units. Explicit locale localizes units/numbers; omission preserves the
 * legacy English units and host-default numeric formatting. No foreground locale read. */
export function formatSize(bytes: number | null | undefined, locale?: string): string | null {
  if (bytes === null || bytes === undefined || bytes < 0) return null;
  const t = locale === undefined ? undefined : createTranslator(locale);
  if (bytes < 1000)
    return t ? t('file.bytes', { count: bytes }) : `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  if (!t) return `${value >= 100 ? Math.round(value) : sizeFormat.format(value)} ${units[unit]}`;
  const amount = new Intl.NumberFormat(normalizeLocale(locale), { maximumFractionDigits: 1 }).format(
    value >= 100 ? Math.round(value) : value,
  );
  const keys = ['file.kilobytes', 'file.megabytes', 'file.gigabytes', 'file.terabytes'] as const;
  return t(keys[unit], { amount });
}

/** Civil year/day follow the supplied Canvas date context. Omission preserves the
 * existing foreground date module's locale/zone behavior for unmigrated consumers. */
export function formatDay(date: Date, now = new Date(), context?: DateContext): string {
  return context ? context.formatShortDate(date, now) : formatShortDate(date, now);
}

/** "Oct 23 at 12:00 PM" this year, with the year otherwise, in the Canvas display zone. */
export function formatDateTime(date: Date, now = new Date(), context?: DateContext): string {
  if (context)
    return context.t('date.at', { day: context.formatShortDate(date, now), time: context.formatTime(date) });
  const sameYear = formatDate(date, { year: 'numeric' }) === formatDate(now, { year: 'numeric' });
  return formatDate(date, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Availability in words, or null when simply available. Explicit context scopes
 * both language and Canvas zone. Omission retains English wrappers and legacy dates. */
export function availabilityOf(
  file: { lockedForUser: boolean; unlockAt: Date | null; lockAt: Date | null; hidden?: boolean },
  now = new Date(),
  context?: DateContext,
): { tone: 'warning' | 'neutral'; short: string; long: string } | null {
  const t = context?.t ?? createTranslator('en');
  if (file.lockedForUser) {
    if (file.unlockAt && file.unlockAt > now)
      return {
        tone: 'warning',
        short: t('file.lockedUntil', { date: formatDay(file.unlockAt, now, context) }),
        long: t('file.lockedUntil', { date: formatDateTime(file.unlockAt, now, context) }),
      };
    if (file.lockAt && file.lockAt <= now)
      return {
        tone: 'warning',
        short: t('file.locked'),
        long: t('file.lockedSince', { date: formatDateTime(file.lockAt, now, context) }),
      };
    return { tone: 'warning', short: t('file.locked'), long: t('file.instructorLocked') };
  }
  if (file.lockAt && file.lockAt > now)
    return {
      tone: 'neutral',
      short: t('file.availableUntil', { date: formatDay(file.lockAt, now, context) }),
      long: t('file.availableUntil', { date: formatDateTime(file.lockAt, now, context) }),
    };
  if (file.hidden)
    return {
      tone: 'neutral',
      short: t('file.hidden'),
      long: t('file.hiddenExplanation'),
    };
  return null;
}
