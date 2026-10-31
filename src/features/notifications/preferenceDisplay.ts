import type { PreferenceCategory, PreferenceGroup, Frequency } from '@/canvas/api/preferences';
import type { Translate } from '@/i18n/types';

const categoryKeys = {
  due_date: ['preferences.due_date.title', 'preferences.due_date.description'],
  grading_policies: ['preferences.grading_policies.title', 'preferences.grading_policies.description'],
  course_content: ['preferences.course_content.title', 'preferences.course_content.description'],
  files: ['preferences.files.title', 'preferences.files.description'],
  announcement: ['preferences.announcement.title', 'preferences.announcement.description'],
  announcement_created_by_you: ['preferences.announcement_created_by_you.title', 'preferences.announcement_created_by_you.description'],
  grading: ['preferences.grading.title', 'preferences.grading.description'],
  invitation: ['preferences.invitation.title', 'preferences.invitation.description'],
  submission_comment: ['preferences.submission_comment.title', 'preferences.submission_comment.description'],
  discussion: ['preferences.discussion.title', 'preferences.discussion.description'],
  discussion_entry: ['preferences.discussion_entry.title', 'preferences.discussion_entry.description'],
  discussion_mention: ['preferences.discussion_mention.title', 'preferences.discussion_mention.description'],
  added_to_conversation: ['preferences.added_to_conversation.title', 'preferences.added_to_conversation.description'],
  conversation_message: ['preferences.conversation_message.title', 'preferences.conversation_message.description'],
  conversation_created: ['preferences.conversation_created.title', 'preferences.conversation_created.description'],
  appointment_signups: ['preferences.appointment_signups.title', 'preferences.appointment_signups.description'],
  appointment_cancelations: ['preferences.appointment_cancelations.title', 'preferences.appointment_cancelations.description'],
  appointment_availability: ['preferences.appointment_availability.title', 'preferences.appointment_availability.description'],
  calendar: ['preferences.calendar.title', 'preferences.calendar.description'],
  membership_update: ['preferences.membership_update.title', 'preferences.membership_update.description'],
  recording_ready: ['preferences.recording_ready.title', 'preferences.recording_ready.description'],
  access_requests: ['preferences.access_requests.title', 'preferences.access_requests.description'],
  account_notification: ['preferences.account_notification.title', 'preferences.account_notification.description'],
  alert: ['preferences.alert.title', 'preferences.alert.description'],
  blueprint: ['preferences.blueprint.title', 'preferences.blueprint.description'],
  content_link_error: ['preferences.content_link_error.title', 'preferences.content_link_error.description'],
  portfolio: ['preferences.portfolio.title', 'preferences.portfolio.description'],
  reminder: ['preferences.reminder.title', 'preferences.reminder.description'],
  reported_reply: ['preferences.reported_reply.title', 'preferences.reported_reply.description'],
  other: ['preferences.other.title', 'preferences.other.description'],
} as const;

export function preferenceText(category: PreferenceCategory, t: Translate) {
  const keys = Object.prototype.hasOwnProperty.call(categoryKeys, category.id)
    ? categoryKeys[category.id as keyof typeof categoryKeys] : undefined;
  return keys ? { title: t(keys[0]), description: t(keys[1]) }
    : { title: readablePreferenceTitle(category.rawTitle ?? category.title), description: category.description };
}

/** Keep custom prose, but never display a Canvas snake_case category key. */
function readablePreferenceTitle(value: string) {
  if (!value.includes('_')) return value;
  const words = value.replace(/_+/g, ' ').trim().toLocaleLowerCase();
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

export function preferenceGroupId(group: PreferenceGroup) {
  // Older cached groups have no metadata. Recover only from stable category IDs.
  return group.id ?? group.categories[0]?.groupId ?? knownGroupId(group.categories[0]?.id) ?? group.categories[0]?.id ?? 'other';
}

const categoryGroupIds: Record<string, NonNullable<PreferenceGroup['id']>> = {
  due_date: 'course',
  grading_policies: 'course',
  course_content: 'course',
  files: 'course',
  announcement: 'course',
  announcement_created_by_you: 'course',
  grading: 'course',
  invitation: 'course',
  submission_comment: 'course',
  discussion: 'discussions',
  discussion_entry: 'discussions',
  discussion_mention: 'discussions',
  added_to_conversation: 'inbox',
  conversation_message: 'inbox',
  conversation_created: 'inbox',
  appointment_signups: 'scheduling',
  appointment_cancelations: 'scheduling',
  appointment_availability: 'scheduling',
  calendar: 'scheduling',
  membership_update: 'groups',
  recording_ready: 'conferences',
  other: 'other',
};

export function preferenceGroupTitle(group: PreferenceGroup, t: Translate) {
  const id = group.id ?? group.categories[0]?.groupId ?? knownGroupId(group.categories[0]?.id);
  return id ? t(`preferences.group.${id}`) : group.title;
}

export function frequencyLabel(frequency: Frequency, t: Translate) {
  return t(`preferences.frequency.${frequency}`);
}

function knownGroupId(id: string | undefined) {
  return id && Object.prototype.hasOwnProperty.call(categoryGroupIds, id) ? categoryGroupIds[id] : undefined;
}
