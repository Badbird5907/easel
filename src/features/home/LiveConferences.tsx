import { LocalizedText as Text } from '@/i18n/LocalizedText';
import { useTranslation } from '@/i18n';
import { Video } from 'lucide-react-native';
import { useEffect } from 'react';
import { View } from 'react-native';
import {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { type LiveConference, useLiveConferences } from '@/canvas/api/conferences';
import { useGroups } from '@/canvas/api/groups';
import type { Course } from '@/canvas/models';
import { useCanvas } from '@/canvas/session';
import { AccentScope, Button, Card, IconTile } from '@/design';
import { AnimatedView } from '@/design/interop';
import { useConferenceBrowser } from '@/features/conferences/conferenceBrowser';
import { useOnline } from '@/features/offline/useOnline';
import { relativeAgeLabel } from '@/lib/dates';

/** A dot that breathes while the conference is live. Still when Reduce Motion is on. */
function LiveDot() {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    opacity.set(withRepeat(withTiming(0.35, { duration: 900 }), -1, true));
    return () => cancelAnimation(opacity);
  }, [opacity, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <AnimatedView className="h-2 w-2 rounded-full bg-danger" animatedStyle={style} />;
}

function ConferenceBanner({
  conference,
  contextName,
  color,
}: {
  conference: LiveConference;
  contextName: string | null;
  color: string | undefined;
}) {
  const { t } = useTranslation();
  const { account } = useCanvas();
  const online = useOnline();
  const { open: join, pending: joining } = useConferenceBrowser({
    source: conference,
    context: { type: conference.contextType, id: conference.contextId },
    url: `${account.baseUrl}${conference.joinPath}`,
    eligible: online,
    notice: 'announcement',
  });
  const started = conference.startedAt
    ? t('conference.started', { when: relativeAgeLabel(conference.startedAt) })
    : null;
  const meta = [contextName, started].filter(Boolean).join(' · ');

  const content = (
    <Card className="flex-row items-center gap-3">
      <IconTile icon={Video} tone="accent" />
      <View className="flex-1 gap-0.5">
        <Text variant="headline" numberOfLines={2}>
          {conference.title}
        </Text>
        <View className="flex-row items-center gap-1.5">
          <LiveDot />
          <Text variant="subhead" weight="semibold" tone="danger">
            {t('conference.live')}
          </Text>
          {meta ? (
            <Text variant="subhead" tone="muted" numberOfLines={1} className="shrink">
              · {meta}
            </Text>
          ) : null}
        </View>
      </View>
      <Button
        size="sm"
        loading={joining}
        disabled={!online}
        accessibilityLabel={
          contextName
            ? t('conference.joinContext', { title: conference.title, context: contextName })
            : t('conference.joinLabel', { title: conference.title })
        }
        onPress={join}
      >
        {t('conference.join')}
      </Button>
    </Card>
  );
  return color ? <AccentScope color={color}>{content}</AccentScope> : content;
}

/**
 * Conferences running now (HOME-8), at the top of Home. "Join" opens Canvas's
 * join page signed in, which hands off to the conference provider.
 */
export function LiveConferences({ courseFor }: { courseFor: (id: string | null) => Course | undefined }) {
  const live = useLiveConferences();
  const groups = useGroups();
  if (!live.data?.length) return null;
  return (
    <View className="gap-3">
      {live.data.map((conference) => {
        const course = conference.contextType === 'course' ? courseFor(conference.contextId) : undefined;
        const group =
          conference.contextType === 'group'
            ? groups.data?.find((g) => g.id === conference.contextId)
            : undefined;
        const groupCourse = group?.courseId ? courseFor(group.courseId) : undefined;
        return (
          <ConferenceBanner
            key={conference.id}
            conference={conference}
            contextName={course?.code ?? group?.name ?? null}
            color={course?.color ?? groupCourse?.color}
          />
        );
      })}
    </View>
  );
}
