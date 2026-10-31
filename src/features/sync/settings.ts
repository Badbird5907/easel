import { registerAccountCleanup } from '@/canvas/session';
import { LocalStore, useLocalStore } from '@/features/offline/store';

/*
 * Course sync settings (OFF-3): which courses and which of their content to
 * keep on the device, how often to sync on its own, and whether to wait for
 * Wi-Fi. Course choices are per account; the schedule is device-wide, as in
 * the official apps.
 */

export type SyncContent =
  | 'pages'
  | 'modules'
  | 'assignments'
  | 'grades'
  | 'syllabus'
  | 'announcements'
  | 'discussions'
  | 'files'
  | 'media';

export const syncContentTypes: { value: SyncContent; label: string; detail: string }[] = [
  { value: 'pages', label: 'Pages', detail: 'Every page and the front page' },
  { value: 'modules', label: 'Modules', detail: 'Modules and what’s in them' },
  { value: 'assignments', label: 'Assignments', detail: 'Descriptions, rubrics, and your submissions' },
  { value: 'grades', label: 'Grades', detail: 'Scores for every grading period' },
  { value: 'syllabus', label: 'Syllabus', detail: 'The syllabus and its schedule' },
  { value: 'announcements', label: 'Announcements', detail: 'Announcements and their replies' },
  { value: 'discussions', label: 'Discussions', detail: 'Topics and their replies' },
  { value: 'files', label: 'Files', detail: 'Documents, slides, and images' },
  { value: 'media', label: 'Audio and video', detail: 'Course recordings and direct embedded clips up to 8 MB. Players and tools need internet.' },
];

export const defaultContent: SyncContent[] = syncContentTypes
  .map((t) => t.value)
  .filter((t) => t !== 'media');

export type SyncSchedule = 'off' | 'daily' | 'weekly';

export type SyncSettings = {
  schedule: SyncSchedule;
  wifiOnly: boolean;
  /** Account ID to course ID to the content to keep. */
  courses: Record<string, Record<string, SyncContent[]>>;
};

const settingsDefaults = (): SyncSettings => ({ schedule: 'off', wifiOnly: true, courses: {} });

export const syncSettingsStore = new LocalStore<SyncSettings>(
  'sync.settings',
  settingsDefaults,
  (stored) => ({
    ...settingsDefaults(),
    ...stored,
  }),
);

export function useSyncSettings(): SyncSettings {
  return useLocalStore(syncSettingsStore);
}

export function setSyncSchedule(schedule: SyncSchedule) {
  syncSettingsStore.update((s) => ({ ...s, schedule }));
}

export function setSyncWifiOnly(wifiOnly: boolean) {
  syncSettingsStore.update((s) => ({ ...s, wifiOnly }));
}

/** Chooses what to keep for one course. An empty list stops syncing it. */
export function setCourseContent(accountId: string, courseId: string, content: SyncContent[]) {
  syncSettingsStore.update((s) => {
    const courses = { ...s.courses[accountId] };
    if (content.length) courses[courseId] = content;
    else delete courses[courseId];
    return { ...s, courses: { ...s.courses, [accountId]: courses } };
  });
}

export function syncedCourses(accountId: string): Record<string, SyncContent[]> {
  return syncSettingsStore.get().courses[accountId] ?? {};
}

/** What the last sync of a course did. */
export type CourseSyncStatus = {
  syncedAt: number | null;
  /** Bytes on the device: synced content plus kept files. */
  bytes: number;
  /** Files kept for this course, so removing the course removes them. */
  fileIds: string[];
  /** Items Canvas wouldn't send (locked, removed), counted but not fatal. */
  skipped: number;
  /** Iframes/tools/streaming embeds that require online services. Included in skipped. */
  unsupportedEmbeds?: number;
  error: string | null;
};

export type SyncStatus = {
  courses: Record<string, Record<string, CourseSyncStatus>>;
  /** When each account last synced on its own. */
  autoSyncedAt: Record<string, number>;
};

const statusDefaults = (): SyncStatus => ({ courses: {}, autoSyncedAt: {} });

export const syncStatusStore = new LocalStore<SyncStatus>('sync.status', statusDefaults, (stored) => ({
  ...statusDefaults(),
  ...stored,
}));

export function useSyncStatus(): SyncStatus {
  return useLocalStore(syncStatusStore);
}

export function courseStatus(accountId: string, courseId: string): CourseSyncStatus | null {
  return syncStatusStore.get().courses[accountId]?.[courseId] ?? null;
}

export function setCourseStatus(accountId: string, courseId: string, status: CourseSyncStatus | null) {
  syncStatusStore.update((s) => {
    const courses = { ...s.courses[accountId] };
    if (status) courses[courseId] = status;
    else delete courses[courseId];
    return { ...s, courses: { ...s.courses, [accountId]: courses } };
  });
}

// Removing an account forgets its sync choices (its files and snapshots go with the account's folders).
registerAccountCleanup((accountId) => {
  syncSettingsStore.update((s) => {
    const courses = { ...s.courses };
    delete courses[accountId];
    return { ...s, courses };
  });
  syncStatusStore.update((s) => {
    const courses = { ...s.courses };
    delete courses[accountId];
    const autoSyncedAt = { ...s.autoSyncedAt };
    delete autoSyncedAt[accountId];
    return { courses, autoSyncedAt };
  });
});
