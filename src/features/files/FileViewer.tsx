import { useHeaderHeight } from 'expo-router/react-navigation';
import type { VideoSource } from 'expo-video';
import { CircleAlert, FileX, Lock, LogIn, ServerCrash, ShieldAlert, WifiOff } from 'lucide-react-native';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';

import { type FileItem, useFile } from '@/canvas/api/files';
import { CanvasAuthError, CanvasError, CanvasNetworkError } from '@/canvas/client';
import { useCanvas } from '@/canvas/session';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, ProgressBar, Screen, Skeleton, Text, useTheme } from '@/design';
import { type MessageKey, type Translate, useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

import { fileWebUrl } from './actions';
import { cachedMeta, type DownloadErrorKind, FileDownloadError } from './download';
import { FileActionBar } from './FileActionBar';
import { FileCard, FileHero } from './FileCard';
import { type FileViewerBrowserIdentity, useFileViewerBrowser } from './fileViewerBrowser';
import { describeFile, extensionFor } from './kinds';
import { seededFile } from './open';
import { ImagePreview } from './previews/ImagePreview';
import { AudioPreview, VideoPreview } from './previews/MediaPreviews';
import { CsvPreview, MarkdownPreview, TextPreview } from './previews/TextPreviews';
import {
  ANDROID_PDF_LIMIT,
  DocViewerPreview,
  HtmlPreview,
  LocalDocumentPreview,
  PdfJsPreview,
} from './previews/WebPreviews';
import { type FileActions, useFileActions } from './useFileActions';
import { downloadPresentation } from './viewerPresentation';

/** How a file previews on this platform (the FILE-3 matrix). */
export type PreviewMode =
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'code'
  | 'csv'
  | 'markdown'
  | 'html'
  | 'docviewer'
  | 'local-document'
  | 'card';

/** Text previews read the whole file into memory; past this, the card offers other apps. */
const TEXT_PREVIEW_LIMIT = 5_000_000;

export function previewModeFor(file: FileItem): PreviewMode {
  const { kind } = describeFile(file);
  const size = file.size ?? 0;
  switch (kind) {
    case 'pdf':
      return Platform.OS === 'android' && size > ANDROID_PDF_LIMIT ? 'card' : 'pdf';
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'text':
    case 'code':
    case 'csv':
    case 'markdown':
      return size > TEXT_PREVIEW_LIMIT ? 'card' : kind;
    case 'html':
      return 'html';
    case 'document':
    case 'spreadsheet':
    case 'presentation':
      if (file.previewUrl) return 'docviewer';
      return Platform.OS === 'ios' ? 'local-document' : 'card';
    default:
      return 'card';
  }
}

/** Previews that scroll and inset themselves below the iOS header. */
const insetsItself = (mode: PreviewMode) =>
  ['pdf', 'local-document', 'html', 'docviewer', 'text', 'code', 'markdown'].includes(mode);

/** Previews that work from the downloaded file rather than a URL. */
const needsLocal = (mode: PreviewMode) => !['video', 'audio', 'docviewer', 'card'].includes(mode);

function cardNote(file: FileItem, failed: boolean, locale: string, t: Translate) {
  if (failed) return t('files.viewer.note.failed');
  const { kind, label } = describeFile(file, locale);
  if ((file.size ?? 0) > TEXT_PREVIEW_LIMIT && ['text', 'code', 'csv', 'markdown'].includes(kind))
    return t('files.viewer.note.large', { type: label });
  if (kind === 'pdf') return t('files.viewer.note.pdf');
  switch (kind) {
    case 'archive':
    case 'document':
    case 'spreadsheet':
    case 'presentation':
      return t(`files.viewer.note.${kind}`);
    default:
      return t('files.viewer.note.unknown');
  }
}

type ErrorKind = DownloadErrorKind | 'unknown';

const errorCopy: Record<ErrorKind, { icon: typeof FileX; title: MessageKey; body: MessageKey }> = {
  not_found: {
    icon: FileX,
    title: 'files.viewer.error.not_found.title',
    body: 'files.viewer.error.not_found.body',
  },
  forbidden: {
    icon: ShieldAlert,
    title: 'files.viewer.error.forbidden.title',
    body: 'files.viewer.error.forbidden.body',
  },
  locked: { icon: Lock, title: 'files.viewer.error.locked.title', body: 'files.viewer.error.locked.body' },
  signed_out: {
    icon: LogIn,
    title: 'files.viewer.error.signed_out.title',
    body: 'files.viewer.error.signed_out.body',
  },
  offline: {
    icon: WifiOff,
    title: 'files.viewer.error.offline.title',
    body: 'files.viewer.error.offline.body',
  },
  server: {
    icon: ServerCrash,
    title: 'files.viewer.error.server.title',
    body: 'files.viewer.error.server.body',
  },
  storage: {
    icon: CircleAlert,
    title: 'files.viewer.error.storage.title',
    body: 'files.viewer.error.storage.body',
  },
  unknown: {
    icon: CircleAlert,
    title: 'files.viewer.error.unknown.title',
    body: 'files.viewer.error.unknown.body',
  },
};

function metadataErrorKind(error: unknown): ErrorKind {
  if (error instanceof CanvasNetworkError) return 'offline';
  if (error instanceof CanvasAuthError) return 'signed_out';
  if (error instanceof CanvasError) {
    if (error.status === 404) return 'not_found';
    if (error.status === 403 || error.status === 401) return 'forbidden';
    if (error.status >= 500) return 'server';
  }
  return 'unknown';
}

function ErrorState({
  kind,
  onRetry,
  browserUrl,
  file,
  browserIdentity,
}: {
  kind: ErrorKind;
  onRetry?: () => void;
  browserUrl?: string;
  file?: FileItem;
  browserIdentity: FileViewerBrowserIdentity;
}) {
  const { t } = useTranslation();
  const copy = Object.hasOwn(errorCopy, kind) ? errorCopy[kind] : errorCopy.unknown;
  const retryable = kind !== 'not_found' && kind !== 'forbidden';
  const showBrowser = !!browserUrl && ['forbidden', 'signed_out', 'server', 'unknown'].includes(kind);
  const openBrowser = useFileViewerBrowser(browserIdentity, file, kind, browserUrl, showBrowser);
  return (
    <Screen>
      <View className="items-center">
        {file ? (
          <View className="pt-6">
            <FileHero file={file} />
          </View>
        ) : null}
        <EmptyState
          icon={copy.icon}
          title={t(copy.title)}
          description={t(copy.body)}
          className={cn(file && 'pt-6', showBrowser && 'pb-4')}
          action={retryable && onRetry ? { label: t('common.retry'), onPress: onRetry } : undefined}
        />
        {showBrowser ? (
          <Button variant="ghost" onPress={openBrowser}>
            {t('files.viewer.browser')}
          </Button>
        ) : null}
      </View>
    </Screen>
  );
}

function DownloadingState({ file, actions }: { file: FileItem; actions: FileActions }) {
  const { t, locale } = useTranslation();
  const { download } = actions;
  const fraction = download.status === 'downloading' ? download.progress.fraction : null;
  const bytes = download.status === 'downloading' ? download.progress.bytes : 0;
  const progress = downloadPresentation(fraction, bytes, locale);
  return (
    <View className="flex-1 justify-center gap-8 px-8">
      <FileHero file={file} />
      {download.status === 'downloading' ? (
        <View className="gap-2">
          <ProgressBar value={fraction ?? 0} accessibilityLabel={progress.label} />
          <View className="flex-row items-center justify-between">
            <Text variant="footnote" tone="muted" tabular>
              {progress.text}
            </Text>
            <Button variant="ghost" size="sm" onPress={download.cancel}>
              {t('common.cancel')}
            </Button>
          </View>
        </View>
      ) : (
        <Button variant="tonal" onPress={() => actions.download.ensure().catch(() => {})}>
          {t('files.viewer.downloadPreview')}
        </Button>
      )}
    </View>
  );
}

function LoadingState() {
  const { t } = useTranslation();
  return (
    <View
      className="flex-1 items-center justify-center gap-4 px-8"
      accessible
      accessibilityLabel={t('files.viewer.loading')}
    >
      <Skeleton className="h-20 w-20 rounded-3xl" />
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
    </View>
  );
}

function mediaSource(
  file: FileItem,
  actions: FileActions,
  auth: Record<string, string>,
  baseUrl: string,
): VideoSource | null {
  // A downloaded copy plays offline; otherwise stream rather than wait for the whole file.
  if (actions.download.local) return { uri: actions.download.local.uri, metadata: { title: file.name } };
  if (!file.url) return null;
  let headers: Record<string, string> | undefined;
  try {
    headers = new URL(file.url).host === new URL(baseUrl).host ? auth : undefined;
  } catch {
    headers = undefined;
  }
  return { uri: file.url, headers, metadata: { title: file.name } };
}

export type FileViewerProps = {
  fileId: string;
  courseId?: string;
  canvasUrl?: string;
  /** The page on screen. Off-screen pages in the pager wait to download. */
  active?: boolean;
  onFile?: (file: FileItem | undefined) => void;
  onZoomChange?: (zoomed: boolean) => void;
  /** "2 of 5" when swiping between files. */
  position?: string;
};

/** "2 of 5", floating above whatever sits at the bottom of the page. */
function PositionPill({ text, bottom }: { text?: string; bottom: number }) {
  const { shadows } = useTheme();
  if (!text) return null;
  return (
    <View pointerEvents="none" className="absolute inset-x-0 items-center" style={{ bottom }}>
      <View className="rounded-full bg-surface-raised px-3 py-1" style={{ boxShadow: shadows.raised }}>
        <Text variant="caption" tone="muted" tabular accessibilityLiveRegion="polite">
          {text}
        </Text>
      </View>
    </View>
  );
}

/** One file: metadata, download, the right preview or the file card, and its actions. */
export function FileViewer({
  fileId,
  courseId,
  canvasUrl,
  active = true,
  onFile,
  onZoomChange,
  position,
}: FileViewerProps) {
  const { t, locale } = useTranslation();
  const { account, client } = useCanvas();
  const insets = useSafeAreaInsets();
  const floating = Math.max(insets.bottom, 12) + 8;
  // iOS headers float over content; fixed previews start below them.
  const headerHeight = useHeaderHeight();
  const seed = useMemo(() => seededFile(fileId), [fileId]);
  const query = useFile(fileId, { courseId, seed });
  const metaError = query.isError ? metadataErrorKind(query.error) : null;

  // Offline: the copy saved with an earlier download. No permission (some inbox and
  // submission attachments): the attachment JSON the list had, if it has a URL.
  const fallback = useMemo(() => {
    if (metaError === 'offline') return cachedMeta(account.id, fileId) ?? undefined;
    if ((metaError === 'forbidden' || metaError === 'not_found') && seed?.url) return seed;
    return undefined;
  }, [metaError, account.id, fileId, seed]);

  const file = query.data ?? fallback;
  const settled = !!file && (!query.isPlaceholderData || query.isError);
  // A preview that fails falls back to the file card, for this file only.
  const [failedId, setFailedId] = useState<string | null>(null);
  const failed = !!file && failedId === file.id;
  const mode: PreviewMode = file ? (failed ? 'card' : previewModeFor(file)) : 'card';
  const actions = useFileActions(file, {
    canvasUrl,
    autoDownload: active && settled && needsLocal(mode) && !file?.lockedForUser,
    toastOffset: mode === 'card' ? 24 : 96,
  });

  // Report the full record once it replaces the seed, so Details shows everything.
  useEffect(() => {
    if (active) onFile?.(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, file]);

  const top = Platform.OS === 'ios' ? headerHeight : 0;

  if (!file) {
    if (query.isPending)
      return (
        <View className="flex-1" style={{ paddingTop: top }}>
          <LoadingState />
        </View>
      );
    return (
      <ErrorState
        browserIdentity={{
          accountId: account.id,
          baseUrl: account.baseUrl,
          client,
          fileId,
          courseId,
          canvasUrl,
          active,
          source: 'metadata',
          error: query.error,
        }}
        kind={metaError ?? 'unknown'}
        onRetry={() => query.refetch()}
        browserUrl={canvasUrl ?? `${account.baseUrl}/files/${fileId}`}
      />
    );
  }

  const browserUrl = fileWebUrl(account.baseUrl, file, canvasUrl);
  const onError = () => setFailedId(file.id);

  const card = (
    <View className="flex-1">
      <Screen>
        <FileCard
          file={file}
          courseId={courseId}
          actions={actions}
          note={file.lockedForUser ? undefined : cardNote(file, failed, locale, t)}
        />
      </Screen>
      <PositionPill text={position} bottom={floating} />
      {actions.elements}
    </View>
  );

  if (file.lockedForUser) return card;
  if (mode === 'card') return card;

  let preview: ReactNode = null;
  let padTop = !insetsItself(mode);
  if (needsLocal(mode)) {
    const { download } = actions;
    if (download.status === 'error') {
      const error = download.error;
      return (
        <ErrorState
          browserIdentity={{
            accountId: account.id,
            baseUrl: account.baseUrl,
            client,
            fileId,
            courseId,
            canvasUrl,
            active,
            source: 'download',
            error,
          }}
          kind={error instanceof FileDownloadError ? error.kind : 'unknown'}
          file={file}
          browserUrl={browserUrl}
          onRetry={() => download.ensure().catch(() => {})}
        />
      );
    }
    if (download.status !== 'ready' || !settled) {
      padTop = true;
      preview = <DownloadingState file={file} actions={actions} />;
    } else {
      const local = download.local;
      const label = t('file.rowLabel', { name: file.name, summary: describeFile(file, locale).label });
      switch (mode) {
        case 'image':
          preview = (
            <ImagePreview
              uri={local.uri}
              accessibilityLabel={label}
              onZoomChange={onZoomChange}
              onError={onError}
            />
          );
          break;
        case 'pdf':
          preview =
            Platform.OS === 'ios' ? (
              <LocalDocumentPreview local={local} title={label} onError={onError} />
            ) : (
              <PdfJsPreview local={local} title={label} onError={onError} />
            );
          break;
        case 'local-document':
          preview = <LocalDocumentPreview local={local} title={label} onError={onError} />;
          break;
        case 'html':
          preview = <HtmlPreview local={local} title={label} onError={onError} />;
          break;
        case 'text':
        case 'code':
          preview = <TextPreview local={local} code={mode === 'code'} onError={onError} />;
          break;
        case 'csv':
          preview = (
            <CsvPreview
              local={local}
              delimiter={extensionFor(file) === 'tsv' ? '\t' : ','}
              onError={onError}
            />
          );
          break;
        case 'markdown':
          preview = <MarkdownPreview local={local} onError={onError} />;
          break;
      }
    }
  } else if (mode === 'video' || mode === 'audio') {
    const source = mediaSource(file, actions, client.authHeaders, account.baseUrl);
    if (!source) return card;
    // Off-screen pages don't start players.
    preview = !active ? (
      <View className="flex-1 justify-center px-8">
        <FileHero file={file} />
      </View>
    ) : mode === 'video' ? (
      <VideoPreview source={source} title={file.name} onError={onError} />
    ) : (
      <AudioPreview source={source} file={file} onError={onError} />
    );
  } else if (mode === 'docviewer' && file.previewUrl) {
    preview = <DocViewerPreview url={file.previewUrl} title={file.name} onError={onError} />;
  }

  return (
    <View className="flex-1 bg-bg">
      <View className="flex-1" style={{ paddingTop: padTop ? top : 0 }}>
        {preview}
        <PositionPill text={position} bottom={12} />
      </View>
      <FileActionBar actions={actions} locked={false} />
      {actions.elements}
    </View>
  );
}
