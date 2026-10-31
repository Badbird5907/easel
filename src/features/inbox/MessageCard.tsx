import { Ellipsis, Reply } from 'lucide-react-native';
import { type ComponentRef, type RefObject, useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';

import type { ConversationMessage } from '@/canvas/api/conversations';
import type { Person } from '@/canvas/api/discussions';
import { Avatar, Card, IconButton, Text } from '@/design';
import { AttachmentList } from '@/features/files/AttachmentList';
import { useBrowsingPresentation } from './browsingPresentation';

import { MediaMessage } from './MediaMessage';

/** "to you", "to Amara Osei", "to you and 3 others". */
function recipientsLine(
  message: ConversationMessage,
  people: Map<string, Person>,
  userId: string,
  p: ReturnType<typeof useBrowsingPresentation>,
): string | null {
  const { t } = p;
  const ids = message.participantIds.filter((id) => id !== message.authorId);
  if (ids.length === 0) return null;
  const others = ids
    .filter((id) => id !== userId)
    .map((id) => people.get(id))
    .filter((p): p is Person => !!p);
  const includesMe = ids.includes(userId);
  if (includesMe && others.length === 0) return t('inboxBrowse.toYou');
  if (includesMe)
    return others.length === 1
      ? t('inboxBrowse.toYouName', { name: others[0].name })
      : t('inboxBrowse.toYouOthers', { count: others.length });
  return t('inboxBrowse.toNames', { names: p.people(others) });
}

function Forwarded({ message, now }: { message: ConversationMessage; now: Date }) {
  const { t, dates } = useBrowsingPresentation();
  return (
    <View className="gap-1.5 border-s-2 border-border ps-3">
      <Text variant="footnote" tone="muted">
        {t('inboxBrowse.forwarded', {
          name: message.author?.name ?? t('inboxBrowse.unknown'),
          date: dates.formatDueDate(message.createdAt, now),
        })}
      </Text>
      <Text variant="subhead" selectable>
        {message.body}
      </Text>
      {message.media ? (
        <MediaMessage media={message.media} author={message.author?.name ?? t('inboxBrowse.unknown')} />
      ) : null}
      <AttachmentList attachments={message.attachments} />
      {message.forwarded.map((f) => (
        <Forwarded key={f.id} message={f} now={now} />
      ))}
    </View>
  );
}

type MessageCardProps = {
  message: ConversationMessage;
  people: Map<string, Person>;
  userId: string;
  courseId: string | null;
  now: Date;
  canReply: boolean;
  /** Omit both for a read-only quote, as in a forward. */
  onReply?: () => void;
  onMore?: (trigger: RefObject<ComponentRef<typeof View> | null>) => void;
};

/** One message: who sent it, to whom, when, the text, and its files. */
export function MessageCard({
  message,
  people,
  userId,
  courseId,
  now,
  canReply,
  onReply,
  onMore,
}: MessageCardProps) {
  const presentation = useBrowsingPresentation();
  const { t, dates } = presentation;
  const menuTrigger = useRef<ComponentRef<typeof View>>(null);
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  if (message.generated) {
    return (
      <Text variant="footnote" tone="muted" align="center" className="px-6">
        {message.body}
      </Text>
    );
  }

  const mine = message.authorId === userId;
  const name = mine ? t('inboxBrowse.you') : (message.author?.name ?? t('inboxBrowse.unknown'));
  const to = recipientsLine(message, people, userId, presentation);

  return (
    <Card className="gap-3">
      <View className="items-start gap-3" style={{ flexDirection: largeText ? 'column' : 'row' }}>
        <Avatar name={message.author?.name ?? name} uri={message.author?.avatarUrl} />
        <View
          accessible
          accessibilityLabel={`${name}${to ? `, ${to}` : ''}, ${dates.formatDueDate(message.createdAt, now)}`}
          style={{ flex: largeText ? undefined : 1, alignSelf: largeText ? 'stretch' : undefined }}
        >
          <Text variant="subhead" weight="semibold" numberOfLines={largeText ? undefined : 1}>
            {name}
          </Text>
          <Text variant="footnote" tone="muted" numberOfLines={largeText ? undefined : 2}>
            {[to, dates.formatDueDate(message.createdAt, now)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <View className="-me-2 -mt-1 flex-row" style={{ alignSelf: largeText ? 'flex-end' : undefined }}>
          {canReply && !mine && onReply ? (
            <IconButton
              icon={Reply}
              size="sm"
              accessibilityLabel={t('inboxBrowse.replyTo', { name })}
              onPress={onReply}
            />
          ) : null}
          {onMore ? (
            <IconButton
              ref={menuTrigger}
              icon={Ellipsis}
              size="sm"
              accessibilityLabel={t('inboxBrowse.messageMore')}
              onPress={() => onMore(menuTrigger)}
            />
          ) : null}
        </View>
      </View>
      {message.body ? (
        <Text variant="body" selectable>
          {message.body}
        </Text>
      ) : null}
      {message.media ? <MediaMessage media={message.media} author={name} /> : null}
      <AttachmentList attachments={message.attachments} courseId={courseId ?? undefined} />
      {message.forwarded.map((f) => (
        <Forwarded key={f.id} message={f} now={now} />
      ))}
    </Card>
  );
}
