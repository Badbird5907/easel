/**
 * Communication channels and Canvas notification preferences (SET-4).
 *
 * Shapes: lib/api/v1/communication_channel.rb, lib/api/v1/notification_policy.rb.
 * Routes: communication_channels_controller.rb#index and
 * notification_preferences_controller.rb (index, update, update_all,
 * update_preferences_by_category). Changes live on globalThis, so they survive
 * this file reloading and reset when the server restarts.
 */
import { BASE, user } from '../data.mjs';

/** Every channel the student has: a confirmed email, a confirmed phone, an unconfirmed second email, and push. */
const channels = [
  { id: '3001', address: user.primary_email, type: 'email', position: 1, workflow_state: 'active' },
  { id: '3002', address: '(555) 555-0123', type: 'sms', position: 2, workflow_state: 'active' },
  { id: '3003', address: 'evan.personal@example.com', type: 'email', position: 3, workflow_state: 'unconfirmed' },
  { id: '3004', address: 'For All Devices', type: 'push', position: 4, workflow_state: 'active' },
];

/** Notification names by category slug, as Canvas's notification seeds group them. */
// prettier-ignore
const catalog = {
  due_date: ['assignment_due_date_changed', 'assignment_due_date_override_changed'],
  grading_policies: ['grade_weight_changed'],
  course_content: ['assignment_changed', 'assignment_created', 'quiz_regrade_finished', 'wiki_page_updated'],
  files: ['new_file_added', 'new_files_added'],
  announcement: ['new_announcement'],
  announcement_created_by_you: ['announcement_created_by_you', 'announcement_reply'],
  grading: ['assignment_graded', 'submission_graded', 'submission_grade_changed'],
  invitation: ['collaboration_invitation', 'web_conference_invitation', 'peer_review_invitation', 'rubric_assessment_submission_reminder'],
  submission_comment: ['submission_comment', 'submission_comment_for_teacher'],
  discussion: ['new_discussion_topic'],
  discussion_entry: ['new_discussion_entry'],
  discussion_mention: ['discussion_mention'],
  added_to_conversation: ['added_to_conversation'],
  conversation_message: ['conversation_message'],
  conversation_created: ['conversation_created'],
  appointment_availability: ['appointment_group_published', 'appointment_group_updated'],
  appointment_cancelations: ['appointment_canceled_by_user', 'appointment_deleted_for_user'],
  appointment_signups: ['appointment_reserved_for_user'],
  calendar: ['new_event_created', 'event_date_changed'],
  membership_update: ['new_student_organized_group'],
  recording_ready: ['web_conference_recording_ready'],
  // Instructor-only: Easel filters it out.
  all_submissions: ['assignment_submitted', 'assignment_resubmitted'],
};

/** Canvas's defaults for a new student (notification.rb#default_frequency), by channel type. */
function defaultFrequency(type, category) {
  if (type === 'sms') return ['announcement', 'grading'].includes(category) ? 'immediately' : 'never';
  if (type === 'push')
    return ['announcement', 'grading', 'conversation_message', 'due_date', 'submission_comment'].includes(category)
      ? 'immediately'
      : 'never';
  if (['due_date', 'grading', 'announcement', 'conversation_message', 'added_to_conversation', 'invitation'].includes(category))
    return 'immediately';
  if (['course_content', 'files', 'discussion', 'calendar'].includes(category)) return 'weekly';
  if (category === 'conversation_created' || category === 'announcement_created_by_you') return 'never';
  return 'daily';
}

const store = (globalThis.__fakeCanvasPreferences ??= { frequencies: {} });

function policies(channel) {
  const saved = (store.frequencies[channel.id] ??= {});
  return Object.entries(catalog).flatMap(([category, names]) =>
    names.map((notification) => ({
      href: `${BASE}/users/${user.id}/communication_channels/${channel.type}/${encodeURIComponent(channel.address)}/notification_preferences/${notification}`,
      notification,
      category,
      frequency: saved[notification] ?? defaultFrequency(channel.type, category),
    })),
  );
}

const FREQUENCIES = new Set(['immediately', 'daily', 'weekly', 'never']);
const notFound = () => ({ status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } });
const badFrequency = () => ({ status: 400, body: { errors: [{ message: 'Invalid frequency' }] } });
const channelById = (id) => channels.find((c) => c.id === String(id));

function set(channel, notification, frequency) {
  (store.frequencies[channel.id] ??= {})[notification] = frequency;
}

export const routes = [
  {
    path: '/api/v1/users/:userId/communication_channels',
    handler: () =>
      channels.map((c) => ({
        id: c.id,
        address: c.address,
        type: c.type,
        position: c.position,
        user_id: user.id,
        workflow_state: c.workflow_state,
        created_at: '2025-08-20T15:00:00Z',
      })),
  },
  {
    path: '/api/v1/users/:userId/communication_channels/:channelId/notification_preferences',
    handler: ({ params }) => {
      const channel = channelById(params.channelId);
      if (!channel) return notFound();
      return { notification_preferences: policies(channel) };
    },
  },
  {
    path: '/api/v1/users/:userId/communication_channels/:channelId/notification_preference_categories',
    handler: ({ params }) => {
      const channel = channelById(params.channelId);
      if (!channel) return notFound();
      return { categories: Object.keys(catalog) };
    },
  },
  {
    // update_all: notification_preferences[<notification>][frequency]
    method: 'PUT',
    path: '/api/v1/users/self/communication_channels/:channelId/notification_preferences',
    handler: ({ params, body }) => {
      const channel = channelById(params.channelId);
      if (!channel) return notFound();
      const prefs = body?.notification_preferences ?? {};
      const entries = Array.isArray(prefs)
        ? prefs.map((p) => [p.notification, p])
        : Object.entries(prefs);
      if (entries.some(([, p]) => !FREQUENCIES.has(p?.frequency))) return badFrequency();
      for (const [notification, p] of entries) set(channel, notification, p.frequency);
      const changed = new Set(entries.map(([n]) => n));
      return { notification_preferences: policies(channel).filter((p) => changed.has(p.notification)) };
    },
  },
  {
    method: 'PUT',
    path: '/api/v1/users/self/communication_channels/:channelId/notification_preferences/:notification',
    handler: ({ params, body }) => {
      const channel = channelById(params.channelId);
      if (!channel) return notFound();
      const pref = Array.isArray(body?.notification_preferences)
        ? body.notification_preferences[0]
        : body?.notification_preferences;
      if (!FREQUENCIES.has(pref?.frequency)) return badFrequency();
      set(channel, params.notification, pref.frequency);
      return { notification_preferences: policies(channel).filter((p) => p.notification === params.notification) };
    },
  },
  {
    method: 'PUT',
    path: '/api/v1/users/self/communication_channels/:channelId/notification_preference_categories/:category',
    handler: ({ params, body, query }) => {
      const channel = channelById(params.channelId);
      if (!channel) return notFound();
      const frequency = body?.notification_preferences?.frequency ?? query['notification_preferences[frequency]'];
      if (!FREQUENCIES.has(frequency)) return badFrequency();
      // Canvas titleizes the slug and misses `discussion_entry`; the fake takes any slug.
      const names = catalog[params.category] ?? [];
      for (const notification of names) set(channel, notification, frequency);
      return { notification_preferences: policies(channel).filter((p) => p.category === params.category) };
    },
  },
];
