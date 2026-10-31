import type { DiscussionTopic } from '@/canvas/api/discussions';
import type { Announcement } from '@/canvas/models';
import { createTranslator, formatNumber } from '@/i18n/runtime';
import { createDateContext } from '@/lib/dates';

/** Explicit inputs keep Compiler-memoized rows reactive to locale and Canvas zone. */
export function discussionPresentation(locale: string, zone: string) {
  const t = createTranslator(locale);
  const dates = createDateContext(locale, zone);
  const number = (value: number) => formatNumber(value, { maximumSignificantDigits: 21 }, locale);
  // Keep plural selection numeric while displaying the separately formatted value.
  const pointParams = (count: number) => ({ count, points: number(count) });
  const countParams = (count: number) => ({ count, number: number(count) });
  const replies = (count: number, unread = false) => {
    // Numeric grammar and display precision are independent; never pluralize a formatted string.
    const params = { count, number: number(count) };
    return t(unread ? 'discussions.unreadReplies' : 'discussions.replies', params);
  };
  function ageLabel(date: Date, now: Date) {
    const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
    if (minutes < 1) return t('date.now');
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days >= 7) return dates.formatShortDate(date, now);
    const [value, unit] = minutes < 60 ? [minutes, 'minute'] as const :
      hours < 24 ? [hours, 'hour'] as const : [days, 'day'] as const;
    return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-value, unit);
  }
  function meta(topic: DiscussionTopic, now: Date) {
    const parts: string[] = [];
    const next = topic.checkpoints.find((c) => c.dueAt && c.dueAt >= now) ?? topic.checkpoints[0];
    if (next?.dueAt) {
      parts.push(t(next.kind === 'reply_to_topic' ? 'discussions.replyDue' : 'discussions.repliesDue', {
        date: dates.formatDueDate(next.dueAt, now),
      }));
    } else if (topic.assignment?.dueAt) {
      parts.push(t('discussions.due', { date: dates.formatDueDate(topic.assignment.dueAt, now) }));
    }
    if (topic.assignment?.points != null) parts.push(t('discussions.points', pointParams(topic.assignment.points)));
    parts.push(topic.isGroupDiscussion ? t('discussions.group') : replies(topic.replyCount));
    if (!topic.assignment && topic.lastReplyAt) parts.push(t('discussions.lastReply', { age: dates.relativeAge(topic.lastReplyAt, now) }));
    return parts.join(' · ');
  }
  const author = (a: Announcement) => a.authorNameFallback === 'unknown' ? t('discussions.unknownAuthor') : a.author.name;
  return { t, dates, number, pointParams, countParams, replies, ageLabel, meta, author };
}
