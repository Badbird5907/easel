import { useEvent } from 'expo';
import {
  type SubtitleTrack,
  useVideoPlayer,
  type VideoPlayer,
  type VideoSource,
  VideoView,
} from 'expo-video';
import { Captions, CaptionsOff, Pause, Play, RotateCcw, RotateCw } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { FileItem } from '@/canvas/api/files';
import { Chip, IconButton, ProgressBar, Text } from '@/design';

import { useTranslation } from '@/i18n';
import { previewClock, previewSpokenTime } from './presentation';

import { FileHero } from '../FileCard';

const SKIP_SECONDS = 15;
const RATES = [1, 1.25, 1.5, 2, 0.75];

// The player is a native object; these setters keep its mutation out of render code.
const setSubtitle = (player: VideoPlayer, track: SubtitleTrack | null) => {
  player.subtitleTrack = track;
};
const setTime = (player: VideoPlayer, seconds: number) => {
  player.currentTime = seconds;
};
const setRate = (player: VideoPlayer, rate: number) => {
  player.playbackRate = rate;
};

/** Player status as state; reports load failures so the viewer can fall back to the file card. */
function usePlayerStatus(player: ReturnType<typeof useVideoPlayer>, onError: () => void) {
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    if (status === 'error') onError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  return status;
}

/**
 * Video with the platform's own controls: scrubbing, playback speed, full screen,
 * and picture in picture. Captions embedded in the file show with a toggle.
 */
export function VideoPreview({
  source,
  title,
  onError,
}: {
  source: VideoSource;
  title: string;
  onError: () => void;
}) {
  const { t } = useTranslation();
  const player = useVideoPlayer(source, (p) => {
    p.timeUpdateEventInterval = 0;
  });
  usePlayerStatus(player, onError);
  const { availableSubtitleTracks } = useEvent(player, 'availableSubtitleTracksChange', {
    availableSubtitleTracks: player.availableSubtitleTracks,
  });
  const { subtitleTrack } = useEvent(player, 'subtitleTrackChange', {
    subtitleTrack: player.subtitleTrack,
  });

  return (
    <View className="flex-1 bg-overlay">
      <VideoView
        player={player}
        style={{ flex: 1 }}
        nativeControls
        contentFit="contain"
        allowsPictureInPicture
        fullscreenOptions={{ enable: true }}
        accessibilityLabel={title}
      />
      {availableSubtitleTracks.length > 0 ? (
        <View className="absolute left-3 top-3">
          <Chip
            icon={subtitleTrack ? Captions : CaptionsOff}
            selected={!!subtitleTrack}
            accessibilityLabel={t(
              subtitleTrack ? 'files.previews.captionsOn' : 'files.previews.captionsOff',
            )}
            onPress={() => {
              setSubtitle(player, subtitleTrack ? null : (availableSubtitleTracks[0] ?? null));
            }}
          >
            {t('files.previews.captions')}
          </Chip>
        </View>
      ) : null}
    </View>
  );
}

/** Audio: play, scrub, skip 15 seconds, and change speed. Keeps playing in the background. */
export function AudioPreview({
  source,
  file,
  onError,
}: {
  source: VideoSource;
  file: FileItem;
  onError: () => void;
}) {
  const { t, locale } = useTranslation();
  const player = useVideoPlayer(source, (p) => {
    p.timeUpdateEventInterval = 0.25;
    p.staysActiveInBackground = true;
    p.showNowPlayingNotification = true;
  });
  const status = usePlayerStatus(player, onError);
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const time = useEvent(player, 'timeUpdate', null);
  const currentTime = time?.currentTime ?? 0;
  const loaded = useEvent(player, 'sourceLoad', null);
  const duration = loaded?.duration || player.duration || 0;
  const [rate, setRateState] = useState(1);
  const [trackWidth, setTrackWidth] = useState(0);

  const seek = (to: number) => {
    setTime(player, Math.max(0, Math.min(duration || to, to)));
  };

  return (
    <View className="flex-1 justify-center gap-10 px-6">
      <FileHero file={file} />
      <View className="gap-2">
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={t('files.previews.position')}
          accessibilityValue={{
            text: t('files.previews.positionValue', {
              current: previewSpokenTime(currentTime, locale),
              total: previewSpokenTime(duration, locale),
            }),
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) =>
            seek(
              currentTime +
                (event.nativeEvent.actionName === 'increment' ? SKIP_SECONDS : -SKIP_SECONDS),
            )
          }
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
          onPress={(e) => {
            if (trackWidth > 0 && duration > 0)
              seek((e.nativeEvent.locationX / trackWidth) * duration);
          }}
          hitSlop={{ top: 16, bottom: 16 }}
          className="py-2"
        >
          <ProgressBar value={duration > 0 ? currentTime / duration : 0} size="md" />
        </Pressable>
        <View className="flex-row justify-between">
          <Text
            variant="caption"
            tone="muted"
            tabular
            accessibilityLabel={previewSpokenTime(currentTime, locale)}
          >
            {previewClock(currentTime, locale)}
          </Text>
          <Text
            variant="caption"
            tone="muted"
            tabular
            accessibilityLabel={
              status === 'loading' && !duration
                ? t('files.previews.loading')
                : t('files.previews.remaining', {
                    time: previewSpokenTime(Math.max(0, duration - currentTime), locale),
                  })
            }
          >
            {status === 'loading' && !duration
              ? t('files.previews.loading')
              : t('files.previews.remainingClock', {
                  time: previewClock(Math.max(0, duration - currentTime), locale),
                })}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center justify-center gap-8">
        <IconButton
          icon={RotateCcw}
          size="lg"
          accessibilityLabel={t('files.previews.back', { count: SKIP_SECONDS })}
          onPress={() => seek(currentTime - SKIP_SECONDS)}
        />
        <IconButton
          icon={isPlaying ? Pause : Play}
          variant="primary"
          size="lg"
          className="h-16 w-16"
          accessibilityLabel={t(isPlaying ? 'files.previews.pause' : 'files.previews.play')}
          disabled={status === 'error'}
          onPress={() => (isPlaying ? player.pause() : player.play())}
        />
        <IconButton
          icon={RotateCw}
          size="lg"
          accessibilityLabel={t('files.previews.forward', { count: SKIP_SECONDS })}
          onPress={() => seek(currentTime + SKIP_SECONDS)}
        />
      </View>
      <View className="items-center">
        <Chip
          accessibilityLabel={t('files.previews.speed', { rate })}
          onPress={() => {
            const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
            setRate(player, next);
            setRateState(next);
          }}
        >
          {t('files.previews.speedDisplay', { rate })}
        </Chip>
      </View>
    </View>
  );
}
