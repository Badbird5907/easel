import { Paperclip, CirclePlay, Star, Users } from 'lucide-react-native';
import {
  Children,
  Fragment,
  isValidElement,
  type ComponentRef,
  type ReactNode,
  type RefObject,
  useRef,
} from 'react';
import { Platform, Pressable, useWindowDimensions, View } from 'react-native';

import type { Conversation } from '@/canvas/api/conversations';
import type { Course } from '@/canvas/models';
import { Avatar, Divider, Icon, Text, useTheme, withAlpha } from '@/design';
import { cn } from '@/lib/cn';
import { daysFrom, dayLabel, formatTime } from '@/lib/dates';

import { useBrowsingPresentation } from './browsingPresentation';

/** "2:15 PM" today, then "Yesterday", then "Tue, Oct 27". */
export function messageDate(date: Date, now = new Date()): string {
  return daysFrom(date, now) === 0 ? formatTime(date) : dayLabel(date, now);
}

/** "Maya Chen, Jordan Lee +2". */
export function peopleLabel(people: { name: string }[], max = 2): string {
  if (people.length === 0) return 'Only you';
  const names = people.slice(0, max).map((p) => p.name);
  return people.length > max ? `${names.join(', ')} +${people.length - max}` : names.join(', ');
}

/** A rounded group of inbox rows with inset separators. */
export function ConversationList({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View className="overflow-hidden rounded-2xl bg-surface" style={{ borderCurve: 'continuous' }}>
      {rows.map((row, index) => (
        <Fragment key={row.key ?? index}>
          {index > 0 ? <Divider inset={68} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

type ConversationRowProps = {
  conversation: Conversation;
  course?: Course;
  /** In Sent, preview the student's own latest message. */
  sent?: boolean;
  now?: Date;
  onPress: () => void;
  onLongPress: (trigger?: RefObject<ComponentRef<typeof View> | null>) => void;
};

export function ConversationRow({
  conversation: c,
  course,
  sent = false,
  now = new Date(),
  onPress,
  onLongPress,
}: ConversationRowProps) {
  const presentation = useBrowsingPresentation();
  const { t } = presentation;
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const trigger = useRef<ComponentRef<typeof View>>(null);
  const openMenu = () => onLongPress(trigger);
  const people = presentation.people(c.audience);
  const date = sent ? (c.lastAuthoredMessageAt ?? c.lastMessageAt) : c.lastMessageAt;
  const preview = sent ? c.lastAuthoredMessage || c.lastMessage : c.lastMessage;
  const subject = c.subject || t('inboxBrowse.noSubject');
  const when = date ? presentation.messageDate(date, now) : '';

  return (
    <Pressable
      ref={trigger}
      accessibilityRole="button"
      accessibilityLabel={[
        c.unread ? t('inboxBrowse.unread') : null,
        people,
        subject,
        preview,
        when,
        c.starred ? t('inboxBrowse.starred') : null,
        c.hasAttachments ? t('inboxBrowse.attachments') : null,
        c.hasMedia ? t('inboxBrowse.media') : null,
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint={t('inboxBrowse.longPress')}
      accessibilityActions={[{ name: 'longpress', label: t('inboxBrowse.more') }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && openMenu()}
      onPress={onPress}
      onLongPress={openMenu}
      android_ripple={{ color: withAlpha(colors.fg, 0.08) }}
      className={cn('flex-row items-start gap-3 px-4 py-3', Platform.OS === 'ios' && 'active:bg-surface-sunken')}
    >
      {c.audience.length > 1 ? (
        <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-sunken">
          <Icon icon={Users} size={20} tone="muted" />
        </View>
      ) : (
        <Avatar
          name={c.audience[0]?.name ?? t('inboxBrowse.you')}
          uri={c.audience[0]?.avatarUrl}
          decorative
        />
      )}
      <View className="flex-1 gap-0.5">
        <View className={largeText ? 'items-start gap-1' : 'flex-row items-center gap-2'}>
          <Text
            variant="body"
            weight={c.unread ? 'semibold' : 'medium'}
            numberOfLines={largeText ? undefined : 1}
            className={largeText ? undefined : 'flex-1'}
          >
            {people}
          </Text>
          <View className={cn('flex-row items-center gap-2', largeText && 'self-stretch')}>
            {c.unread ? <View className="h-2 w-2 rounded-full bg-accent" /> : null}
            <Text variant="caption" tone={c.unread ? 'accent' : 'subtle'} tabular className="shrink">
              {when}
            </Text>
          </View>
        </View>
        <View className="flex-row items-center gap-1.5">
          <Text
            variant="subhead"
            weight={c.unread ? 'semibold' : 'regular'}
            numberOfLines={largeText ? undefined : 1}
            className="flex-1"
          >
            {subject}
          </Text>
          {c.hasMedia ? <Icon icon={CirclePlay} size={14} tone="subtle" /> : null}
          {c.hasAttachments ? <Icon icon={Paperclip} size={14} tone="subtle" /> : null}
          {c.starred ? <Icon icon={Star} size={14} tone="warning" strokeWidth={2.25} /> : null}
        </View>
        <Text variant="subhead" tone="muted" numberOfLines={3}>
          {[course?.code, preview].filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim()}
        </Text>
      </View>
    </Pressable>
  );
}
