import { File, FileMode } from 'expo-file-system';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, ScrollView, View } from 'react-native';

import { useCanvas } from '@/canvas/session';
import { Callout, Screen, Text, type TextVariant, useTheme } from '@/design';
import { openCanvasLink } from '@/features/content/links';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/** Past this, show the beginning and say so: a phone isn't the place for a 40 MB log. */
const TEXT_LIMIT = 1_000_000;
const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

type Loaded = { text: string; truncated: boolean };

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let code = b;
    let extra = 0;
    if (b >= 0xf0) [code, extra] = [b & 0x07, 3];
    else if (b >= 0xe0) [code, extra] = [b & 0x0f, 2];
    else if (b >= 0xc0) [code, extra] = [b & 0x1f, 1];
    for (let k = 1; k <= extra; k += 1) code = (code << 6) | (bytes[i + k] & 0x3f);
    out += String.fromCodePoint(code);
    i += extra + 1;
  }
  return out;
}

function readText(local: File): Loaded {
  const size = local.size ?? 0;
  if (size <= TEXT_LIMIT) return { text: local.textSync(), truncated: false };
  const handle = local.open(FileMode.ReadOnly);
  try {
    const bytes = handle.readBytesSync(TEXT_LIMIT);
    // Drop a multibyte character cut in half at the end.
    let end = bytes.length;
    while (end > 0 && (bytes[end - 1] & 0xc0) === 0x80) end -= 1;
    if (end > 0 && bytes[end - 1] >= 0xc0) end -= 1;
    return { text: decodeUtf8(bytes.subarray(0, end)), truncated: true };
  } finally {
    handle.close();
  }
}

function useText(local: File, onError: () => void): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let alive = true;
    // Let the screen paint before reading.
    const id = setTimeout(() => {
      try {
        const result = readText(local);
        if (alive) setLoaded(result);
      } catch {
        if (alive) onError();
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.uri]);
  return loaded;
}

function Loading() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator color={colors.fgMuted} accessibilityLabel={t('files.previews.loading')} />
    </View>
  );
}

function TruncatedNote({ rows }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <Callout
      tone="info"
      title={
        rows === undefined
          ? t('files.previews.truncatedTitle', { size: 1 })
          : t('files.previews.truncatedRows', { count: rows })
      }
    >
      {t('files.previews.truncatedBody')}
    </Callout>
  );
}

/** Plain text and code. Code keeps its lines and scrolls sideways; prose wraps. */
export function TextPreview({
  local,
  code,
  onError,
}: {
  local: File;
  code: boolean;
  onError: () => void;
}) {
  const { t } = useTranslation();
  const loaded = useText(local, onError);
  // Chunks keep long files virtualized without splitting lines mid-way.
  const chunks = useMemo(() => {
    if (!loaded) return [];
    const lines = loaded.text.replace(/\r\n?/g, '\n').split('\n');
    const out: { key: string; text: string; start: number }[] = [];
    for (let i = 0; i < lines.length; i += 80)
      out.push({ key: String(i), text: lines.slice(i, i + 80).join('\n'), start: i + 1 });
    return out;
  }, [loaded]);

  if (!loaded) return <Loading />;
  if (!loaded.text.trim())
    return (
      <Screen>
        <Text variant="body" tone="muted" align="center">
          {t('files.previews.emptyFile')}
        </Text>
      </Screen>
    );

  const body = (
    <FlatList
      data={chunks}
      keyExtractor={(c) => c.key}
      initialNumToRender={4}
      windowSize={7}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="px-4 pb-16 pt-3"
      ListHeaderComponent={
        loaded.truncated ? (
          <View className="mb-3">
            <TruncatedNote />
          </View>
        ) : undefined
      }
      renderItem={({ item }) => (
        <Text
          selectable
          variant={code ? 'footnote' : 'body'}
          style={code ? { fontFamily: mono, lineHeight: 19 } : undefined}
        >
          {item.text}
        </Text>
      )}
    />
  );
  if (!code) return <View className="flex-1 bg-bg">{body}</View>;
  return (
    <ScrollView horizontal className="flex-1 bg-bg" contentContainerStyle={{ minWidth: '100%' }}>
      {body}
    </ScrollView>
  );
}

/** RFC 4180 CSV (and TSV): quoted fields, escaped quotes, newlines inside quotes. */
export function parseDelimited(text: string, delimiter: string, maxRows = 5000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length >= maxRows) return rows;
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function CsvRow({
  cells,
  header,
  widths,
  head,
  index,
}: {
  cells: string[];
  header: string[];
  widths: number[];
  head?: boolean;
  index: number;
}) {
  const { t } = useTranslation();
  return (
    <View
      className={cn(
        'flex-row border-b border-border',
        head ? 'bg-surface-sunken' : index % 2 ? 'bg-bg' : 'bg-surface',
      )}
      accessible
      accessibilityLabel={
        head
          ? t('files.previews.columns', { columns: cells.join(', ') })
          : cells
              .map((cell, c) =>
                t('files.previews.cell', {
                  column: header[c] ?? t('files.previews.column', { number: c + 1 }),
                  value: cell || t('files.previews.emptyCell'),
                }),
              )
              .join(', ')
      }
    >
      {widths.map((w, c) => (
        <View
          key={c}
          style={{ width: w }}
          className="justify-center border-r border-border px-3 py-2"
        >
          <Text variant="footnote" weight={head ? 'semibold' : undefined} numberOfLines={3} tabular>
            {cells[c] ?? ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

const CELL_MIN = 64;
const CELL_MAX = 240;
const CHAR_WIDTH = 8.2;

/** CSV as a table: a sticky header row, columns sized to their content, scrolling both ways. */
export function CsvPreview({
  local,
  delimiter,
  onError,
}: {
  local: File;
  delimiter: string;
  onError: () => void;
}) {
  const { t } = useTranslation();
  const loaded = useText(local, onError);
  const rows = useMemo(
    () => (loaded ? parseDelimited(loaded.text, delimiter) : []),
    [loaded, delimiter],
  );
  const widths = useMemo(() => {
    const columns = Math.max(0, ...rows.slice(0, 200).map((r) => r.length));
    return Array.from({ length: columns }, (_, c) => {
      const longest = Math.max(...rows.slice(0, 200).map((r) => (r[c] ?? '').length));
      return Math.round(Math.min(CELL_MAX, Math.max(CELL_MIN, longest * CHAR_WIDTH + 24)));
    });
  }, [rows]);

  if (!loaded) return <Loading />;
  if (rows.length === 0)
    return (
      <Screen>
        <Text variant="body" tone="muted" align="center">
          {t('files.previews.emptyFile')}
        </Text>
      </Screen>
    );

  const [header, ...body] = rows;
  const total = widths.reduce((a, b) => a + b, 0);
  return (
    <ScrollView horizontal className="flex-1 bg-bg" contentContainerStyle={{ minWidth: '100%' }}>
      <View style={{ width: Math.max(total, 1) }}>
        <FlatList
          data={body}
          keyExtractor={(_, i) => String(i)}
          stickyHeaderIndices={[0]}
          ListHeaderComponent={
            <CsvRow cells={header} header={header} widths={widths} head index={0} />
          }
          initialNumToRender={30}
          contentContainerStyle={{ paddingBottom: 48 }}
          ListFooterComponent={
            loaded.truncated || rows.length >= 5000 ? (
              <View className="p-4" style={{ maxWidth: 420 }}>
                <TruncatedNote rows={rows.length >= 5000 ? rows.length : undefined} />
              </View>
            ) : undefined
          }
          renderItem={({ item, index }) => (
            <CsvRow cells={item} header={header} widths={widths} index={index} />
          )}
        />
      </View>
    </ScrollView>
  );
}

// --- Markdown ----------------------------------------------------------------------------

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'rule' };

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i += 1;
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', text: body.join(' ') });
      continue;
    }
    const item = /^\s*([-*+]|\d+[.)])\s+/;
    if (item.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && (item.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (item.test(lines[i])) items.push(lines[i].replace(item, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6})\s|^\s*(```|~~~|>)|^\s*([-*+]|\d+[.)])\s+/.test(lines[i])
    )
      body.push(lines[i++].trim());
    blocks.push({ type: 'paragraph', text: body.join(' ') });
  }
  return blocks;
}

type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) spans.push({ text: text.slice(last, match.index) });
    const [token] = match;
    if (match[1]) spans.push({ text: token.slice(1, -1), code: true });
    else if (match[2]) spans.push({ text: token.slice(2, -2), bold: true });
    else if (match[3]) spans.push({ text: token.slice(1, -1), italic: true });
    else if (match[4]) {
      const [, label, href] = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      spans.push({ text: label, href });
    } else spans.push({ text: token, href: token });
    last = match.index! + token.length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}

function Inline({ text, variant = 'body' }: { text: string; variant?: TextVariant }) {
  const { account } = useCanvas();
  return (
    <>
      {parseInline(text).map((span, i) => {
        if (span.href) {
          const href = span.href;
          return (
            <Text
              key={i}
              variant={variant}
              tone="accent"
              accessibilityRole="link"
              className="underline"
              onPress={() => openCanvasLink(href, account.baseUrl)}
            >
              {span.text}
            </Text>
          );
        }
        if (span.code)
          return (
            <Text
              key={i}
              variant={variant}
              className="bg-surface-sunken"
              style={{ fontFamily: mono, fontSize: 14 }}
            >
              {span.text}
            </Text>
          );
        return (
          <Text
            key={i}
            variant={variant}
            weight={span.bold ? 'semibold' : undefined}
            style={span.italic ? { fontStyle: 'italic' } : undefined}
          >
            {span.text}
          </Text>
        );
      })}
    </>
  );
}

const headingVariant = ['title1', 'title2', 'title3', 'headline', 'headline', 'headline'] as const;

/** Markdown rendered natively: headings, lists, quotes, code, links, emphasis. */
export function MarkdownPreview({ local, onError }: { local: File; onError: () => void }) {
  const { t } = useTranslation();
  const loaded = useText(local, onError);
  const blocks = useMemo(() => (loaded ? parseMarkdown(loaded.text) : []), [loaded]);
  if (!loaded) return <Loading />;
  return (
    <Screen contentClassName="gap-4">
      {loaded.truncated ? <TruncatedNote /> : null}
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':
            return (
              <Text
                key={i}
                variant={headingVariant[block.level - 1]}
                accessibilityRole="header"
                className={i ? 'mt-2' : undefined}
              >
                <Inline text={block.text} variant={headingVariant[block.level - 1]} />
              </Text>
            );
          case 'paragraph':
            return (
              <Text key={i} variant="body" selectable>
                <Inline text={block.text} />
              </Text>
            );
          case 'list':
            return (
              <View key={i} className="gap-1.5">
                {block.items.map((itemText, n) => (
                  <View key={n} className="flex-row gap-2.5 pr-2">
                    <Text
                      variant="body"
                      tone="muted"
                      tabular
                      style={{ minWidth: block.ordered ? 22 : 12 }}
                    >
                      {block.ordered ? t('files.previews.orderedNumber', { number: n + 1 }) : '•'}
                    </Text>
                    <Text variant="body" className="flex-1" selectable>
                      <Inline text={itemText} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          case 'quote':
            return (
              <View key={i} className="border-l-2 border-border-strong pl-3">
                <Text variant="body" tone="muted">
                  <Inline text={block.text} />
                </Text>
              </View>
            );
          case 'code':
            return (
              <ScrollView
                key={i}
                horizontal
                className="rounded-xl bg-surface-sunken"
                contentContainerClassName="p-3"
              >
                <Text variant="footnote" selectable style={{ fontFamily: mono, lineHeight: 19 }}>
                  {block.text}
                </Text>
              </ScrollView>
            );
          case 'rule':
            return <View key={i} className="h-hairline bg-border" />;
        }
      })}
    </Screen>
  );
}
