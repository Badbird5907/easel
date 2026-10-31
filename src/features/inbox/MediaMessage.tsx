import { useEvent } from 'expo';
import { type VideoPlayer, type VideoSource, useVideoPlayer, VideoView } from 'expo-video';
import { AudioLines, Pause, Play, Video } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { CanvasClient } from '@/canvas/client';
import type { MessageMedia } from '@/canvas/api/conversations';
import { useCanvas } from '@/canvas/session';
import { Button, Icon, IconButton, ProgressBar, Text } from '@/design';
import { useTranslation } from '@/i18n';

import { createMediaMessageBrowser, type MediaMessageBrowserState } from './mediaMessageBrowser';
import { useMediaMessageLifetime } from './mediaMessageLifetime';
import { mediaMessagePresentation } from './mediaMessagePresentation';

/*
 * Recorded video and audio messages (INBOX-2). Canvas serves them from
 * `media_download`, which needs the student's token, then redirects to the file.
 */

const SKIP_SECONDS = 15;

// The player is a native object; this keeps its mutation out of render code.
const seekTo = (player: VideoPlayer, seconds: number) => {
  player.currentTime = seconds;
};

/** Reports a failed load once, so the message can offer the browser instead. */
function useLoadFailure(player: VideoPlayer, onError: () => void) {
  const owner = useMediaMessageLifetime(player);
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    if (owner() && status === 'error') onError();
  }, [status, onError, owner]);
  return status;
}

function VideoMessage({
  source,
  label,
  onError,
}: {
  source: VideoSource;
  label: string;
  onError: () => void;
}) {
  const player = useVideoPlayer(source);
  useLoadFailure(player, onError);
  return (
    <View
      className="overflow-hidden rounded-xl bg-overlay"
      style={{ aspectRatio: 16 / 9, borderCurve: 'continuous' }}
    >
      <VideoView
        player={player}
        style={{ flex: 1 }}
        nativeControls
        contentFit="contain"
        allowsPictureInPicture
        fullscreenOptions={{ enable: true }}
        accessibilityLabel={label}
      />
    </View>
  );
}

function AudioMessage({
  source,
  label,
  onError,
}: {
  source: VideoSource;
  label: string;
  onError: () => void;
}) {
  const { t, locale } = useTranslation();
  const { clock, spokenTime } = useMemo(() => mediaMessagePresentation(locale), [locale]);
  const player = useVideoPlayer(source, (p) => {
    p.timeUpdateEventInterval = 0.25;
  });
  const owner = useMediaMessageLifetime(player);
  const status = useLoadFailure(player, onError);
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const time = useEvent(player, 'timeUpdate', null);
  const loaded = useEvent(player, 'sourceLoad', null);
  const currentTime = time?.currentTime ?? 0;
  const duration = loaded?.duration || player.duration || 0;
  const [trackWidth, setTrackWidth] = useState(0);
  const seek = (to: number) => {
    if (owner()) seekTo(player, Math.max(0, Math.min(duration || to, to)));
  };

  return (
    <View
      className="flex-row items-center gap-3 rounded-xl bg-surface-sunken py-2 pe-4 ps-2"
      style={{ borderCurve: 'continuous' }}
    >
      <IconButton
        icon={isPlaying ? Pause : Play}
        variant="primary"
        accessibilityLabel={t(isPlaying ? 'inboxMedia.pause' : 'inboxMedia.play', { label })}
        disabled={status === 'error'}
        onPress={() => {
          if (owner()) {
            if (isPlaying) player.pause();
            else player.play();
          }
        }}
      />
      <View className="flex-1 gap-1.5">
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={t('inboxMedia.position')}
          accessibilityValue={{
            text: t('inboxMedia.positionValue', {
              current: spokenTime(currentTime),
              duration: spokenTime(duration),
            }),
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) =>
            seek(currentTime + (event.nativeEvent.actionName === 'increment' ? SKIP_SECONDS : -SKIP_SECONDS))
          }
          onLayout={(e) => {
            if (owner()) setTrackWidth(e.nativeEvent.layout.width);
          }}
          onPress={(e) => {
            if (trackWidth > 0 && duration > 0) seek((e.nativeEvent.locationX / trackWidth) * duration);
          }}
          hitSlop={{ top: 14, bottom: 14 }}
          className="py-1.5"
        >
          <ProgressBar value={duration > 0 ? currentTime / duration : 0} size="sm" />
        </Pressable>
        <View className="flex-row justify-between">
          <Text variant="caption" tone="muted" tabular>
            {clock(currentTime)}
          </Text>
          <Text variant="caption" tone="muted" tabular>
            {status === 'loading' && !duration
              ? t('inboxMedia.loading')
              : t('inboxMedia.remaining', { time: clock(Math.max(0, duration - currentTime)) })}
          </Text>
        </View>
      </View>
    </View>
  );
}

type MediaOwner = {
  generation: number;
  accountId: string;
  client: CanvasClient;
  authorization: string;
  url: MessageMedia['url'];
  kind: MessageMedia['kind'];
};

/** An inline player for a message's recorded video or audio, with a browser fallback. */
export function MediaMessage({ media, author }: { media: MessageMedia; author: string }) {
  const { account, client } = useCanvas();
  const { url, kind } = media;
  const authorization = client.authHeaders.Authorization;
  const [owner, setOwner] = useState<MediaOwner>(() => ({
    generation: 0,
    accountId: account.id,
    client,
    authorization,
    url,
    kind,
  }));
  const matches =
    owner.accountId === account.id &&
    owner.client === client &&
    owner.authorization === authorization &&
    owner.url === url &&
    owner.kind === kind;
  // Render-state adjustment gives a real replacement a new subtree key. Ownership
  // itself is activated/retired only by committed effects in that subtree.
  if (!matches) {
    setOwner({ generation: owner.generation + 1, accountId: account.id, client, authorization, url, kind });
    return null;
  }
  return (
    <MediaSource
      key={owner.generation}
      media={media}
      author={author}
      client={client}
      authorization={authorization}
    />
  );
}

function MediaSource({
  media,
  author,
  client,
  authorization,
}: {
  media: MessageMedia;
  author: string;
  client: CanvasClient;
  authorization: string;
}) {
  const { t } = useTranslation();
  const owner = useMediaMessageLifetime(client);
  const [failed, setFailed] = useState(false);
  const [browserState, setBrowserState] = useState<MediaMessageBrowserState>('idle');
  const source = useMemo<VideoSource>(
    () => ({ uri: media.url ?? undefined, headers: { Authorization: authorization } }),
    [authorization, media.url],
  );
  const openBrowser = useMemo(
    () => createMediaMessageBrowser(client, media.url ?? '', owner, setBrowserState),
    [client, media.url, owner],
  );
  const onError = useCallback(() => {
    if (owner()) setFailed(true);
  }, [owner]);
  const label = media.title
    ? t(media.kind === 'audio' ? 'inboxMedia.audioTitle' : 'inboxMedia.videoTitle', { title: media.title })
    : t(media.kind === 'audio' ? 'inboxMedia.audioAuthor' : 'inboxMedia.videoAuthor', { author });

  if (!media.url || failed) {
    return (
      <View className="gap-2 rounded-xl bg-surface-sunken p-3" style={{ borderCurve: 'continuous' }}>
        <View className="flex-row items-center gap-2">
          <Icon icon={media.kind === 'audio' ? AudioLines : Video} size={18} tone="muted" />
          <Text variant="subhead" tone="muted" className="flex-1">
            {t(media.kind === 'audio' ? 'inboxMedia.audioUnsupported' : 'inboxMedia.videoUnsupported')}
          </Text>
        </View>
        {media.url ? (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onPress={() => void openBrowser()}
            loading={browserState === 'opening'}
            accessibilityHint={t('inboxMedia.browserHint')}
          >
            {t('inboxMedia.openBrowser')}
          </Button>
        ) : null}
        {browserState === 'failed' ? (
          <Text variant="footnote" tone="danger" accessibilityRole="alert">
            {t('inboxMedia.browserError')}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View className="gap-1.5">
      {media.title ? (
        <View className="flex-row items-center gap-1.5">
          <Icon icon={media.kind === 'audio' ? AudioLines : Video} size={16} tone="muted" />
          <Text variant="footnote" weight="medium" tone="muted" numberOfLines={1} className="flex-1">
            {media.title}
          </Text>
        </View>
      ) : null}
      {media.kind === 'audio' ? (
        <AudioMessage source={source} label={label} onError={onError} />
      ) : (
        <VideoMessage source={source} label={label} onError={onError} />
      )}
    </View>
  );
}
