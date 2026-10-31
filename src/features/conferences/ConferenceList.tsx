import { CirclePlay, Clock, ExternalLink, Radio, Video } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from '@/i18n';

import { type Conference, type Recording, useConferences } from '@/canvas/api/conferences';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  Icon,
  ListItem,
  Section,
  Text,
} from '@/design';
import { ListSkeleton, LoadError } from '@/features/course/states';
import { useDisplayTimeZone } from '@/lib/dates';
import { type ConferenceContext, useConferenceBrowser } from './conferenceBrowser';
import { createConferencePresentation } from './presentation';

function RecordingRow({ recording, conference, context, now }: {
  recording: Recording;
  conference: Conference;
  context: ConferenceContext;
  now: Date;
}) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const presentation = createConferencePresentation(locale, zone);
  const { open } = useConferenceBrowser({
    source: recording,
    conference,
    context,
    url: recording.url ?? '',
    eligible: !!recording.url,
  });
  const meta = [
    recording.createdAt ? presentation.dayLabel(recording.createdAt, now) : null,
    recording.durationMinutes ? presentation.minutes(recording.durationMinutes) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <ListItem
      leading={<Icon icon={CirclePlay} size={22} tone="accent" />}
      title={presentation.recordingTitle(recording)}
      subtitle={meta || undefined}
      subtitleLines={1}
      trailing={recording.url ? <Icon icon={ExternalLink} size={16} tone="subtle" /> : undefined}
      chevron={false}
      accessibilityLabel={[presentation.recordingTitle(recording), meta, recording.url ? t('conferences.opensBrowser') : t('conferences.unavailable')]
        .filter(Boolean)
        .join(', ')}
      onPress={recording.url ? () => void open() : undefined}
    />
  );
}

function ConferenceCard({ conference: c, context, now }: {
  conference: Conference;
  context: ConferenceContext;
  now: Date;
}) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const presentation = createConferencePresentation(locale, zone);
  const [expanded, setExpanded] = useState(c.status !== 'ended' || c.recordings.length > 0);
  const live = c.status === 'live';
  const canJoin = c.status !== 'ended';
  const { open } = useConferenceBrowser({
    source: c,
    context,
    url: live || !c.url ? c.joinPath : c.url,
    eligible: canJoin,
  });
  const status = presentation.statusLine(c, now);

  return (
    <Card padding="none">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={[presentation.conferenceTitle(c), live ? t('conferences.live') : null, status, c.provider].filter(Boolean).join(', ')}
        onPress={() => setExpanded((v) => !v)}
        className="gap-2 p-4 active:opacity-80"
      >
        <View className="flex-row flex-wrap items-center gap-2">
          {live ? (
            <Badge tone="danger" variant="solid" icon={Radio}>
              {t('conferences.live')}
            </Badge>
          ) : c.status === 'ended' ? (
            <Badge>{t('conferences.ended')}</Badge>
          ) : (
            <Badge tone="accent">{t('conferences.scheduled')}</Badge>
          )}
          {c.provider ? (
            <Text variant="footnote" tone="muted">
              {c.provider}
            </Text>
          ) : null}
        </View>
        <Text variant="headline">{presentation.conferenceTitle(c)}</Text>
        <View className="flex-row items-center gap-1.5">
          <Icon icon={Clock} size={14} tone="muted" />
          <Text variant="subhead" tone="muted" className="flex-1">
            {status}
          </Text>
        </View>
      </Pressable>

      {expanded ? (
        <View className="gap-4 px-4 pb-4">
          {c.description ? (
            <Text variant="body" selectable>
              {c.description}
            </Text>
          ) : null}
          {canJoin ? (
            <Button
              leadingIcon={Video}
              variant={live ? 'primary' : 'secondary'}
              onPress={() => void open()}
              accessibilityHint={
                live
                  ? t('conferences.joinHint')
                  : t('conferences.openHint')
              }
            >
              {live ? t('groups.join') : t('conferences.open')}
            </Button>
          ) : null}
        </View>
      ) : null}

      {expanded && c.recordings.length > 0 ? (
        <>
          <Divider />
          <Text variant="subhead" weight="semibold" tone="muted" className="px-4 pt-3">
            {t('conferences.recordings', { count: c.recordings.length })}
          </Text>
          <View className="pb-1">
            {c.recordings.map((r) => (
              <RecordingRow key={r.id} recording={r} conference={c} context={context} now={now} />
            ))}
          </View>
        </>
      ) : null}
    </Card>
  );
}

/**
 * A course's or group's conferences (CONTENT-11): live and scheduled ones with
 * Join, then past ones with their recordings. Join and recordings open in the
 * system browser, signed in, since the meeting runs on the web.
 */
export function ConferenceList({ context }: { context: { type: 'course' | 'group'; id: string } }) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const presentation = createConferencePresentation(locale, zone);
  const conferences = useConferences(context);
  const now = new Date();

  if (conferences.isPending) return <ListSkeleton rows={3} leading={false} />;
  if (conferences.isError)
    return (
      <LoadError
        title={t('conferences.loadError')}
        error={new Error(presentation.errorMessage(conferences.error))}
        onRetry={() => conferences.refetch()}
      />
    );
  if (conferences.data.length === 0)
    return (
      <Card padding="none">
        <EmptyState
          icon={Video}
          title={t('conferences.empty')}
          description={t('conferences.emptyDescription')}
        />
      </Card>
    );

  const current = conferences.data.filter((c) => c.status !== 'ended');
  const past = conferences.data.filter((c) => c.status === 'ended');
  return (
    <>
      {current.length > 0 ? (
        <Section title={t('conferences.current')}>
          <View className="gap-3">
            {current.map((c) => (
              <ConferenceCard key={c.id} conference={c} context={context} now={now} />
            ))}
          </View>
        </Section>
      ) : null}
      {past.length > 0 ? (
        <Section title={t('conferences.past')}>
          <View className="gap-3">
            {past.map((c) => (
              <ConferenceCard key={c.id} conference={c} context={context} now={now} />
            ))}
          </View>
        </Section>
      ) : null}
    </>
  );
}
