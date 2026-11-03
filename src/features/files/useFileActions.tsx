import type { File } from 'expo-file-system';
import { FolderDown, Images } from 'lucide-react-native';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { FileItem } from '@/canvas/api/files';
import { useCanvas } from '@/canvas/session';
import { haptics } from '@/design';
import { useTranslation } from '@/i18n';

import {
  canSaveToPhotos,
  copyLink,
  FileActionError,
  fileWebUrl,
  openInApp,
  saveAsResult,
  saveToDownloadsResult,
  saveToFolderResult,
  saveToPhotos,
  shareFile,
  shareLink,
} from './actions';
import { useActionSheet } from './ActionSheet';
import { useFileDownload } from './download';
import {
  createActionPresentation,
  saveOptionLabel,
  type SaveOptionKey,
} from './actionPresentation';
import type { SaveDestination } from './actionTypes';
import { describeFile } from './kinds';
import { printFile, printKind } from './print';
import { useToast } from './Toast';

export type FileAction = 'share' | 'save' | 'open' | 'link' | 'print';

/** Share, Save, Open in, and Share link for one file, with progress and outcomes. */
export function useFileActions(
  file: FileItem | undefined,
  options: { canvasUrl?: string; toastOffset?: number; autoDownload?: boolean } = {},
) {
  const { account, client } = useCanvas();
  const { locale, t } = useTranslation();
  const viewingLocale = useRef(locale);
  useEffect(() => {
    viewingLocale.current = locale;
  }, [locale]);
  const inFlight = useRef(false);
  const download = useFileDownload(file, { auto: options.autoDownload });
  const { show: showSheet, sheet } = useActionSheet();
  const { show: toast, toast: toastElement } = useToast(options.toastOffset);
  const [busy, setBusy] = useState<FileAction | null>(null);

  type Presentation = ReturnType<typeof createActionPresentation>;
  const report = (error: unknown, presentation: Presentation) => {
    haptics.error();
    toast(presentation.error(error), 'danger');
  };

  /** One synchronous claim shared with print, including callbacks from an open sheet. */
  const withLocal = async (
    action: FileAction,
    run: (local: File, file: FileItem, presentation: Presentation) => Promise<void>,
  ) => {
    if (!file || inFlight.current) return;
    inFlight.current = true;
    const presentation = createActionPresentation(viewingLocale.current);
    setBusy(action);
    try {
      const local = await download.ensure();
      if (local) await run(local, file, presentation);
    } catch (error) {
      report(error, presentation);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const saved = (where: SaveDestination | null, presentation: Presentation) => {
    if (!where) return;
    haptics.success();
    toast(presentation.saved(where));
  };

  const share = () => withLocal('share', (local, f) => shareFile(local, f));

  const openIn = () =>
    withLocal('open', async (local, f) => {
      if (!(await openInApp(local, f)))
        throw new FileActionError(
          `No app on this device opens ${describeFile(f).label} files. Try Share instead.`,
          {
            reason: 'no-app',
            file: { name: f.name, filename: f.filename, contentType: f.contentType },
          },
        );
    });

  /** Touch and hold Save: pick where the file goes (Android adds the gallery for photos and videos). */
  const saveElsewhere = () => {
    if (!file) return;
    const media = canSaveToPhotos(file);
    const ios = Platform.OS === 'ios';
    const photos = {
      key: 'photos' as const,
      label: saveOptionLabel('photos', ios, t),
      icon: Images,
      onPress: () =>
        withLocal('save', async (local, _f, presentation) => {
          await saveToPhotos(local);
          saved(
            ios
              ? { label: 'Photos', origin: 'photos' }
              : { label: 'your gallery', origin: 'gallery' },
            presentation,
          );
        }),
    };
    const toFolder = {
      key: 'folder' as const,
      label: saveOptionLabel('folder', ios, t),
      icon: FolderDown,
      onPress: () =>
        withLocal('save', async (local, f, presentation) => {
          saved(await (ios ? saveToFolderResult(local, f) : saveAsResult(local, f)), presentation);
        }),
    };
    const sheetOptions = [toFolder, ...(media ? [photos] : [])];
    if (sheetOptions.length === 1) {
      sheetOptions[0].onPress();
      return;
    }
    const keys: SaveOptionKey[] = sheetOptions.map((option) => option.key);
    showSheet({
      title: file.name,
      options: sheetOptions,
      presentation: (translator) => ({
        options: keys.map((key) => saveOptionLabel(key, ios, translator)),
      }),
    });
  };

  /** Android: straight to Downloads. iOS: Files, or a choice of Files and Photos. */
  const save = () => {
    if (!file) return;
    if (Platform.OS !== 'android') {
      saveElsewhere();
      return;
    }
    return withLocal('save', async (local, f, presentation) => {
      saved(await saveToDownloadsResult(local, f), presentation);
    });
  };

  // FILE-11: PDFs, images, plain text, and documents DocViewer can turn into a PDF.
  const canPrint = !!file && printKind(file) !== null;
  const print = async () => {
    if (!file || inFlight.current) return;
    inFlight.current = true;
    const presentation = createActionPresentation(viewingLocale.current);
    setBusy('print');
    try {
      await printFile(client, file, () => download.ensure());
    } catch (error) {
      report(error, presentation);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const link = file ? fileWebUrl(account.baseUrl, file, options.canvasUrl) : null;

  const shareCanvasLink = async () => {
    if (!file || !link) return;
    const presentation = createActionPresentation(viewingLocale.current);
    try {
      await shareLink(link, file);
    } catch (error) {
      report(error, presentation);
    }
  };

  const copyCanvasLink = async () => {
    if (!link) return;
    const presentation = createActionPresentation(viewingLocale.current);
    try {
      await copyLink(link);
      haptics.success();
      toast(presentation.copied());
    } catch (error) {
      report(error, presentation);
    }
  };

  const elements: ReactNode = (
    <>
      {sheet}
      {toastElement}
    </>
  );

  return {
    download,
    busy,
    share,
    save,
    saveElsewhere,
    openIn,
    print,
    canPrint,
    shareLink: shareCanvasLink,
    copyLink: copyCanvasLink,
    link,
    elements,
  };
}

export type FileActions = ReturnType<typeof useFileActions>;
