import { Bell, BellOff, BellRing } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';

import { useCanvas } from '@/canvas/session';
import { IconTile, ListItem } from '@/design';
import { ensurePermission, useNotificationPermission } from '@/features/notifications/permission';
import { useNotificationSettings } from '@/features/notifications/settings';
import { useTranslation } from '@/i18n';
import { createDateContext, useDisplayTimeZone } from '@/lib/dates';

import { describeReminder, fireTime, type ReminderItem, sortReminders } from './model';
import { ReminderSheet } from './ReminderSheet';
import {
  addReminder,
  clearReminders,
  refreshItems,
  removeReminder,
  toggleOffset,
  useItemReminders,
} from './store';
import { useNow } from './useNow';
// Keeps scheduled notifications in line with every change made here.
import './schedule';

/**
 * Due-date reminders for one item (ASSIGN-14, TODO-7): a row that shows the
 * reminders set for the item and lets the student add or remove them.
 * Render it inside a `ListGroup`.
 */
export type RemindableItem = {
  /** Stable ID across refreshes, e.g. `assignment_123` or `planner_note_45`. */
  id: string;
  title: string;
  dueAt: Date | null;
  courseId?: string | null;
  /** In-app route or Canvas URL the notification opens. */
  url?: string;
};

export function ReminderControl({ item }: { item: RemindableItem }) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const display = useMemo(() => createDateContext(locale, zone), [locale, zone]);
  const { account } = useCanvas();
  const entry = useItemReminders(account.id, item.id);
  const settings = useNotificationSettings();
  const permission = useNotificationPermission();
  const [open, setOpen] = useState(false);
  const [now, refreshNow] = useNow();

  const dueAt =
    item.dueAt instanceof Date && !Number.isNaN(item.dueAt.getTime()) ? item.dueAt.getTime() : null;
  const reminderItem = useMemo<ReminderItem>(
    () => ({ id: item.id, title: item.title, dueAt, courseId: item.courseId ?? null, url: item.url ?? null }),
    [item.id, item.title, dueAt, item.courseId, item.url],
  );

  // The screen has the freshest details: reminders follow a moved due date.
  const stored = !!entry;
  useEffect(() => {
    if (stored) refreshItems(account.id, [reminderItem]);
  }, [stored, account.id, reminderItem]);

  const upcoming = entry
    ? sortReminders(entry.reminders, entry.item).filter((r) => {
        const at = fireTime(r, entry.item);
        return at === null ? r.type === 'before' : at > now;
      })
    : [];

  const value =
    upcoming.length === 0
      ? t('reminder.none')
      : upcoming.length === 1
        ? describeReminder(upcoming[0], display)
        : t('reminder.count', { count: upcoming.length });
  const blocked = permission === 'denied' || !settings.reminders;
  const subtitle =
    upcoming.length === 0
      ? undefined
      : permission === 'denied'
        ? t('reminder.notificationsOff')
        : !settings.reminders
          ? t('reminder.settingsOff')
          : upcoming.length > 1
            ? upcoming.map((reminder) => describeReminder(reminder, display)).join(', ')
            : undefined;
  const reminderLabels = upcoming.length === 0
    ? t('reminder.noneSet')
    : upcoming.map((reminder) => describeReminder(reminder, display)).join(', ');

  /** Asks for permission the first time a reminder is set. */
  const withPermission = (change: () => void) => {
    change();
    void ensurePermission();
  };

  return (
    <>
      <ListItem
        leading={
          <IconTile
            icon={upcoming.length === 0 ? Bell : blocked ? BellOff : BellRing}
            tone={upcoming.length === 0 ? 'neutral' : blocked ? 'warning' : 'accent'}
          />
        }
        title={t('reminder.remindMe')}
        value={value}
        subtitle={subtitle}
        subtitleLines={2}
        accessibilityLabel={subtitle && blocked
          ? t('reminder.blockedLabel', { reminders: reminderLabels, reason: subtitle })
          : t('reminder.label', { reminders: reminderLabels })}
        accessibilityHint={t('reminder.optionsHint')}
        onPress={() => {
          refreshNow();
          setOpen(true);
        }}
      />
      <ReminderSheet
        visible={open}
        now={now}
        item={reminderItem}
        entry={entry}
        permission={permission}
        remindersOn={settings.reminders}
        onToggleOffset={(minutes) => withPermission(() => toggleOffset(account.id, reminderItem, minutes))}
        onAddTime={(at) => withPermission(() => addReminder(account.id, reminderItem, { type: 'at', at }))}
        onRemove={(id) => removeReminder(account.id, reminderItem, id)}
        onClearAll={() => clearReminders(account.id, reminderItem)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
