import { RecordingPresets, useAudioRecorder } from 'expo-audio';
import { Mic, RotateCcw } from 'lucide-react-native';
import { useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';

import type { LocalFile } from '@/canvas/uploads';
import { Button, Callout, haptics, Icon, Sheet, Text, useTheme } from '@/design';
import { useTranslation } from '@/i18n';

import { mediaClock, mediaSpoken } from './mediaPresentation';
import { createRecorderLifetime, initialRecorderView } from './recorderLifetime';

import { MediaPlayer } from './MediaPlayer';

/**
 * Record audio with expo-audio, for a voice comment (ASSIGN-11) or a media
 * submission (ASSIGN-6). Shows a live level meter and timer, lets the student
 * listen back, and hands the file to `onAttach`.
 */
export function AudioRecorderSheet({
  visible,
  onClose,
  onAttach,
  attachLabel,
  fileName = 'Voice comment',
  purpose,
}: {
  visible: boolean;
  onClose: () => void;
  onAttach: (file: LocalFile) => void;
  /** The button that keeps the recording. */
  attachLabel?: string;
  /** Start of the recording's file name, before the date. */
  fileName?: string;
  /** What the recording is for, in "…to record a voice comment." */
  purpose?: string;
}) {
  const { t } = useTranslation();
  const cancelRef = useRef<(() => void) | null>(null);
  return (
    <Sheet
      visible={visible}
      title={t('audioRecorder.title')}
      onClose={() => {
        cancelRef.current?.();
        onClose();
      }}
      doneLabel={t('audioRecorder.cancel')}
    >
      {visible ? (
        <Recorder
          cancelRef={cancelRef}
          onAttach={onAttach}
          attachLabel={attachLabel === undefined ? t('audioRecorder.attach') : attachLabel}
          fileName={fileName}
          purpose={purpose === undefined ? t('audioRecorder.purpose') : purpose}
        />
      ) : null}
    </Sheet>
  );
}

function Recorder({
  cancelRef,
  onAttach,
  attachLabel,
  fileName,
  purpose,
}: {
  cancelRef: { current: (() => void) | null };
  onAttach: (file: LocalFile) => void;
  attachLabel: string;
  fileName: string;
  purpose: string;
}) {
  const { colors } = useTheme();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const { t, locale } = useTranslation();
  const [state, setState] = useState(initialRecorderView);
  const { phase, duration, levels, uri, error } = state;
  const lifetime = useRef<ReturnType<typeof createRecorderLifetime> | null>(null);
  const presentation = useRef({ t, locale });
  // Async action completions use the latest committed explicit locale. Updating
  // this ref never recreates the recorder, timer, or lifecycle.
  useLayoutEffect(() => {
    presentation.current = { t, locale };
  }, [t, locale]);
  useLayoutEffect(() => {
    const session = createRecorderLifetime(recorder, setState, (action, ms) => {
      const current = presentation.current;
      if (action === 'recording') haptics.light();
      else haptics.success();
      AccessibilityInfo.announceForAccessibility(
        action === 'recording'
          ? current.t('audioRecorder.recording')
          : current.t('audioRecorder.recorded', { duration: mediaSpoken(ms / 1000, current.t) }),
      );
    });
    lifetime.current = session;
    cancelRef.current = session.close;
    return () => {
      session.close();
      if (cancelRef.current === session.close) cancelRef.current = null;
      if (lifetime.current === session) lifetime.current = null;
    };
  }, [recorder, cancelRef]);
  const start = () => lifetime.current?.start();
  const stop = () => lifetime.current?.stop();
  const attach = () => {
    if (uri) lifetime.current?.attach(uri, state.take, fileName, onAttach);
  };
  const errorView = error ? (
    <Callout tone="danger" title={t('audioRecorder.errorTitle')} className="self-stretch">
      {t(`audioRecorder.error.${error}`)}
    </Callout>
  ) : null;

  if (phase === 'denied')
    return (
      <View className="gap-3">
        <Callout
          tone="warning"
          title={t('audioRecorder.permissionTitle')}
          action={{
            label: t('audioRecorder.settings'),
            onPress: () => {
              void lifetime.current?.settings();
            },
          }}
        >
          {t('audioRecorder.permissionBody', { purpose })}
        </Callout>
        <Button onPress={start}>{t('audioRecorder.retry')}</Button>
        {errorView}
      </View>
    );

  if (phase === 'review' && uri)
    return (
      <View className="gap-5">
        <MediaPlayer
          url={uri}
          kind="audio"
          title={t('audioRecorder.reviewTitle')}
          subtitle={mediaClock(duration / 1000, locale)}
        />
        <View className="flex-row gap-3">
          <Button
            variant="secondary"
            leadingIcon={RotateCcw}
            className="flex-1"
            onPress={() => {
              lifetime.current?.discard(uri, state.take);
            }}
          >
            {t('audioRecorder.again')}
          </Button>
          <Button className="flex-1" onPress={attach}>
            {attachLabel}
          </Button>
        </View>
        {errorView}
      </View>
    );

  const live = phase === 'recording' || phase === 'stopping';
  const busy = phase === 'starting' || phase === 'stopping';
  return (
    <View className="items-center gap-6 pb-2">
      <Text
        variant="display"
        tabular
        accessibilityRole="timer"
        accessibilityLabel={
          live
            ? t('audioRecorder.timer', { duration: mediaSpoken(duration / 1000, t) })
            : t('audioRecorder.ready')
        }
      >
        {mediaClock(live ? duration / 1000 : 0, locale)}
      </Text>
      <View
        className="h-14 flex-row items-center gap-[3px]"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {levels.map((value, i) => (
          <View
            key={i}
            className="w-1 rounded-full"
            style={{
              height: 4 + value * 52,
              backgroundColor: live ? colors.danger : colors.borderStrong,
              opacity: live ? 0.35 + value * 0.65 : 1,
            }}
          />
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={live ? t('audioRecorder.stop') : t('audioRecorder.start')}
        disabled={busy}
        accessibilityState={{ disabled: busy, busy }}
        onPress={live ? stop : start}
        className="h-20 w-20 items-center justify-center rounded-full border-4 border-border-strong active:opacity-80"
      >
        {live ? (
          <View className="h-8 w-8 rounded-lg bg-danger" style={{ borderCurve: 'continuous' }} />
        ) : (
          <View className="h-16 w-16 items-center justify-center rounded-full bg-danger">
            <Icon icon={Mic} size={28} token="dangerContrast" />
          </View>
        )}
      </Pressable>
      <Text variant="footnote" tone="muted" align="center">
        {live ? t('audioRecorder.limit') : t('audioRecorder.instruction')}
      </Text>
      {errorView}
    </View>
  );
}
