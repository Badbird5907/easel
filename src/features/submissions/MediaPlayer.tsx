import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { AudioLines, Pause, Play } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useCanvas } from '@/canvas/session';
import { Icon, IconButton, Text } from '@/design';
import { useTranslation } from '@/i18n';

import { mediaClock, mediaSpoken } from './mediaPresentation';

/** The bearer token goes only to the school's own Canvas host (media_download needs it). */
function useMediaSource(url: string) {
  const { account, client } = useCanvas();
  return useMemo(() => {
    let sameHost = false;
    try {
      sameHost = new URL(url).host === account.host;
    } catch {
      // Relative or malformed: let the player fail and show its error.
    }
    return { uri: url, headers: sameHost ? client.authHeaders : undefined };
  }, [url, account.host, client]);
}

export type MediaPlayerProps = {
  url: string;
  kind: 'audio' | 'video';
  /** "Voice comment from Dr. Osei", for screen readers and the title line. */
  title: string;
  /** Shown under the title, e.g. the comment's date. */
  subtitle?: string;
};

/**
 * Inline player for media comments, recorded submissions, and voice or video
 * attachments (ASSIGN-10, ASSIGN-11). Nothing loads until the student taps
 * play, so a long comment thread doesn't open a player per recording.
 */
export function MediaPlayer(props: MediaPlayerProps) {
  const [active, setActive] = useState(false);
  if (props.kind === 'video')
    return active ? <ActiveVideo {...props} /> : <VideoPoster {...props} onPlay={() => setActive(true)} />;
  return active ? (
    <ActiveAudio {...props} />
  ) : (
    <AudioShell
      title={props.title}
      subtitle={props.subtitle}
      playing={false}
      onToggle={() => setActive(true)}
    />
  );
}

function AudioShell({
  title,
  subtitle,
  playing,
  onToggle,
  position = 0,
  duration = 0,
  onSeek,
  loading,
}: {
  title: string;
  subtitle?: string;
  playing: boolean;
  onToggle: () => void;
  position?: number;
  duration?: number;
  onSeek?: (seconds: number) => void;
  loading?: boolean;
}) {
  const { t, locale } = useTranslation();
  const [width, setWidth] = useState(0);
  const fraction = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <View
      className="flex-row items-center gap-3 rounded-2xl bg-surface-sunken py-2 pl-2 pr-4"
      style={{ borderCurve: 'continuous' }}
    >
      <IconButton
        icon={playing ? Pause : Play}
        variant="primary"
        accessibilityLabel={t(playing ? 'inlineMedia.pause' : 'inlineMedia.play', { title })}
        accessibilityState={{ busy: !!loading }}
        onPress={onToggle}
      />
      <View className="flex-1 gap-1.5">
        <View className="flex-row items-center gap-1.5">
          <Icon icon={AudioLines} size={14} tone="muted" />
          <Text variant="subhead" weight="medium" numberOfLines={1} className="flex-1">
            {title}
          </Text>
          <Text variant="caption" tone="muted" tabular>
            {duration > 0 ? t('inlineMedia.clocks', { position: mediaClock(position, locale), duration: mediaClock(duration, locale) }) : (subtitle ?? '')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={t('inlineMedia.position', { title })}
          accessibilityValue={{
            text: duration > 0 ? t('inlineMedia.elapsed', { position: mediaSpoken(position, t), duration: mediaSpoken(duration, t) }) : t('inlineMedia.notStarted'),
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) =>
            onSeek?.(position + (e.nativeEvent.actionName === 'increment' ? 10 : -10))
          }
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          onPress={(e) => {
            if (width > 0 && duration > 0) onSeek?.((e.nativeEvent.locationX / width) * duration);
          }}
          hitSlop={{ top: 10, bottom: 10 }}
          className="h-1.5 justify-center"
        >
          <View className="h-1 overflow-hidden rounded-full bg-border-strong">
            <View className="h-full rounded-full bg-accent" style={{ width: `${fraction * 100}%` }} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

function ActiveAudio({ url, title, subtitle }: MediaPlayerProps) {
  const source = useMediaSource(url);
  const player = useAudioPlayer(source, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    player.play();
  }, [player]);

  useEffect(() => {
    if (status.didJustFinish) player.seekTo(0).catch(() => {});
  }, [status.didJustFinish, player]);

  return (
    <AudioShell
      title={title}
      subtitle={subtitle}
      playing={status.playing}
      loading={!status.isLoaded || status.isBuffering}
      position={status.currentTime}
      duration={status.duration}
      onToggle={() => (status.playing ? player.pause() : player.play())}
      onSeek={(seconds) =>
        player.seekTo(Math.max(0, Math.min(status.duration || seconds, seconds))).catch(() => {})
      }
    />
  );
}

function VideoPoster({ title, subtitle, onPlay }: MediaPlayerProps & { onPlay: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('inlineMedia.play', { title })}
      onPress={onPlay}
      className="aspect-video items-center justify-center gap-2 rounded-2xl bg-overlay active:opacity-80"
      style={{ borderCurve: 'continuous' }}
    >
      <View className="h-14 w-14 items-center justify-center rounded-full bg-accent">
        <Icon icon={Play} size={24} tone="onAccent" />
      </View>
      <Text variant="footnote" weight="medium" tone="onAccent" numberOfLines={1}>
        {subtitle ? t('inlineMedia.poster', { title, subtitle }) : title}
      </Text>
    </Pressable>
  );
}

function ActiveVideo({ url, title }: MediaPlayerProps) {
  const source = useMediaSource(url);
  const player = useVideoPlayer(source, (p) => {
    p.play();
  });
  return (
    <View
      className="aspect-video overflow-hidden rounded-2xl bg-overlay"
      style={{ borderCurve: 'continuous' }}
    >
      <VideoView
        player={player}
        style={{ flex: 1 }}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture
        accessibilityLabel={title}
      />
    </View>
  );
}
