import { Camera, FileText, Image as ImageIcon, Mic, ScanLine, Video } from 'lucide-react-native';
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';

import { useCanvas } from '@/canvas/session';
import type { LocalFile } from '@/canvas/uploads';
import { haptics } from '@/design';
import { type SheetOption, useActionSheet } from '@/features/files/ActionSheet';
import {
  pickDocuments,
  PickerPermissionError,
  PickerUnavailableError,
  pickPhotos,
  recordVideo,
  takePhoto,
} from '@/features/files/upload';

import { useTranslation } from '@/i18n';

import {
  cameraPermissionBody,
  pickerErrorDetail,
  pickerLabels,
  pickerNotice,
  pickerPresentation,
  type PickerNotice,
  type PickerOption,
} from './pickerPresentation';
import { acceptsExtension, checkExtensions } from './rules';
import { addUploads } from './uploadStore';

export type Notice = {
  tone: 'warning' | 'danger';
  title: string;
  body: string;
};

/**
 * "Add file": one sheet with every source (ASSIGN-4). Picked files are checked
 * against the assignment's allowed types, then start uploading into `slot`.
 */
export function useAddFiles({
  slot,
  preflightPath,
  allowedExtensions = [],
  onScan,
  onRecordAudio,
  allowVideo = false,
}: {
  slot: string;
  preflightPath: string;
  allowedExtensions?: string[];
  /** Shows "Scan document" when the assignment can take a PDF. */
  onScan?: () => void;
  /** Shows "Record audio" (comments). */
  onRecordAudio?: () => void;
  /** Offers recording a video with the camera (comments). */
  allowVideo?: boolean;
}): {
  open: () => void;
  add: (files: LocalFile[]) => void;
  sheet: ReactNode;
  notice: Notice | null;
  dismiss: () => void;
} {
  const { account, client } = useCanvas();
  const { t, locale } = useTranslation();
  const { show, sheet } = useActionSheet();
  // Value-based snapshot: fresh arrays/callbacks and locale changes are not new contexts.
  const extensionsKey = JSON.stringify(allowedExtensions);
  const extensions: string[] = useMemo(() => JSON.parse(extensionsKey), [extensionsKey]);
  const takesImages = !extensions.length || acceptsExtension(extensions, 'jpg');
  const canScan = !!onScan && (!extensions.length || acceptsExtension(extensions, 'pdf'));
  const canRecordAudio = !!onRecordAudio;
  const accountId = account.id;
  const lifetime = useMemo(
    () => ({
      accountId,
      client,
      slot,
      preflightPath,
      extensionsKey,
      takesImages,
      canScan,
      canRecordAudio,
      allowVideo,
    }),
    [
      accountId,
      client,
      slot,
      preflightPath,
      extensionsKey,
      takesImages,
      canScan,
      canRecordAudio,
      allowVideo,
    ],
  );
  const live = useRef<{
    lifetime: object;
    operation: object | null;
    latest: object | null;
    onScan: typeof onScan;
    onRecordAudio: typeof onRecordAudio;
    t: typeof t;
    show: typeof show;
  } | null>(null);
  useLayoutEffect(() => {
    live.current = {
      lifetime,
      operation: null,
      latest: null,
      onScan,
      onRecordAudio,
      t,
      show,
    };
    return () => {
      if (live.current?.lifetime === lifetime) live.current = null;
    };
    // Callback/translator replacement must not release an outstanding claim.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifetime]);
  useLayoutEffect(() => {
    if (live.current?.lifetime === lifetime)
      Object.assign(live.current, { onScan, onRecordAudio, t, show });
  }, [lifetime, onScan, onRecordAudio, t, show]);
  const isCurrent = () => live.current?.lifetime === lifetime;
  const [result, setResult] = useState<{
    lifetime: object;
    notice: PickerNotice;
  } | null>(null);
  const publish = (notice: PickerNotice | null) => {
    if (isCurrent()) setResult(notice ? { lifetime, notice } : null);
  };

  const add = (files: LocalFile[]) => {
    if (!isCurrent() || !files.length) return;
    const { accepted, rejected } = checkExtensions(files, extensions);
    if (rejected.length) {
      haptics.warning();
      publish({
        reason: 'rejected',
        count: rejected.length,
        name: rejected[0].name,
        extensions,
      });
    } else {
      publish(null);
    }
    if (accepted.length) addUploads(slot, { client, preflightPath }, accepted);
  };

  const guard = (pick: () => Promise<LocalFile[] | LocalFile | null>) => async () => {
    if (!isCurrent() || live.current!.operation) return;
    const operation = {};
    live.current!.operation = operation;
    live.current!.latest = operation;
    // Native Alert labels are one invocation snapshot, even if the locale changes while picking.
    const translate = live.current!.t;
    const currentOutcome = () => isCurrent() && live.current!.latest === operation;
    const owns = () => currentOutcome() && live.current!.operation === operation;
    try {
      const picked = await pick();
      if (owns()) add(Array.isArray(picked) ? picked : picked ? [picked] : []);
    } catch (error) {
      if (!owns()) return;
      if (error instanceof PickerPermissionError) {
        Alert.alert(
          translate('submissionPicker.permissionTitle'),
          cameraPermissionBody(error.message, error.origin, translate),
          [
            { text: translate('submissionPicker.notNow'), style: 'cancel' },
            {
              text: translate('submissionPicker.settings'),
              onPress: async () => {
                if (!currentOutcome()) return;
                try {
                  await Linking.openSettings();
                } catch (settingsError) {
                  if (currentOutcome())
                    publish({
                      reason: 'settings',
                      detail: pickerErrorDetail(settingsError),
                    });
                }
              },
            },
          ],
        );
      } else if (error instanceof PickerUnavailableError) {
        publish({
          reason: 'unavailable',
          detail: error.message,
          origin: error.origin,
        });
      } else {
        publish({ reason: 'picker', detail: pickerErrorDetail(error) });
      }
    } finally {
      if (owns()) live.current!.operation = null;
    }
  };

  const extra = (key: 'onScan' | 'onRecordAudio') => () => {
    if (!isCurrent() || live.current!.operation) return;
    live.current![key]?.();
  };
  const open = () => {
    if (!isCurrent() || live.current!.operation) return;
    const option = (
      key: PickerOption,
      icon: SheetOption['icon'],
      onPress: () => void,
    ): SheetOption & { key: PickerOption } => ({
      key,
      label: t(pickerLabels[key]),
      icon,
      onPress,
    });
    const options = [
      option(
        'file',
        FileText,
        guard(() => pickDocuments()),
      ),
      ...(takesImages
        ? [
            option(
              'photos',
              ImageIcon,
              guard(() => pickPhotos({ videos: allowVideo })),
            ),
            option('photo', Camera, guard(takePhoto)),
          ]
        : []),
      ...(allowVideo
        ? [
            option(
              'video',
              Video,
              guard(() => recordVideo()),
            ),
          ]
        : []),
      ...(canRecordAudio ? [option('audio', Mic, extra('onRecordAudio'))] : []),
      ...(canScan ? [option('scan', ScanLine, extra('onScan'))] : []),
    ];
    const keys = options.map(({ key }) => key);
    live.current!.show({
      options,
      presentation: (translate, displayLocale) =>
        pickerPresentation(keys, extensions, translate, displayLocale),
    });
  };

  const notice = result?.lifetime === lifetime ? pickerNotice(result.notice, t, locale) : null;
  return { open, add, sheet, notice, dismiss: () => publish(null) };
}
