import { Check, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, Callout, haptics, Icon, IconButton, ListGroup, ListItem, Sheet, Text } from '@/design';
import { openNotificationSettings } from '@/features/notifications/permission';
import type { PermissionState } from '@/features/notifications/platform';
import { updateSettings } from '@/features/notifications/settings';
import { DateTimeRow } from '@/features/planner/DateTimeRow';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { createDateContext, useDisplayTimeZone } from '@/lib/dates';

import {
  describeReminder,
  fireTime,
  formatMoment,
  type ItemReminders,
  offsetLabel,
  presetOffsets,
  type ReminderItem,
  sortReminders,
} from './model';

type Props = {
  visible: boolean;
  now: number;
  item: ReminderItem;
  entry: ItemReminders | null;
  permission: PermissionState | null;
  remindersOn: boolean;
  onToggleOffset: (minutes: number) => void;
  onAddTime: (at: number) => void;
  onRemove: (reminderId: string) => void;
  onClearAll: () => void;
  onClose: () => void;
};

/** A sensible first guess for a custom time: three hours before it's due, on the hour, and never in the past. */
function suggestedTime(item: ReminderItem, now: number): Date {
  const hour = 60 * 60_000;
  const guess =
    item.dueAt !== null && item.dueAt - 3 * hour > now + hour ? item.dueAt - 3 * hour : now + hour;
  const date = new Date(guess);
  date.setMinutes(0, 0, 0);
  return date.getTime() <= now ? new Date(date.getTime() + hour) : date;
}

/** Choose reminders for one item: offsets before it's due, a custom date and time, or none (ASSIGN-14). */
export function ReminderSheet({
  visible,
  now,
  item,
  entry,
  permission,
  remindersOn,
  onToggleOffset,
  onAddTime,
  onRemove,
  onClearAll,
  onClose,
}: Props) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const display = useMemo(() => createDateContext(locale, zone), [locale, zone]);
  const [draft, setDraft] = useState<Date | null>(null);
  const reminders = entry ? sortReminders(entry.reminders, entry.item) : [];
  const presetMinutes = new Set(presetOffsets.map((p) => p.minutes));
  const custom = reminders.filter((r) => r.type === 'at' || !presetMinutes.has(r.minutes));
  const hasOffset = (minutes: number) => reminders.some((r) => r.type === 'before' && r.minutes === minutes);
  const draftInPast = draft !== null && draft.getTime() <= now;

  const close = () => {
    setDraft(null);
    onClose();
  };

  return (
    <Sheet visible={visible} title={t('reminder.title')} onClose={close}>
      {permission === 'denied' ? (
        <Callout
          tone="warning"
          title={t('reminder.notificationsOff')}
          action={{ label: t('reminder.openSettings'), onPress: openNotificationSettings }}
        >
          {t('reminder.permissionHint')}
        </Callout>
      ) : null}
      {!remindersOn ? (
        <Callout
          tone="info"
          title={t('reminder.dueOff')}
          action={{
            label: t('reminder.turnOn'),
            onPress: () => updateSettings((s) => ({ ...s, reminders: true })),
          }}
        >
          {t('reminder.savedHint')}
        </Callout>
      ) : null}

      <ListGroup
        header={t('reminder.beforeDue')}
        footer={
          item.dueAt === null
            ? t('reminder.noDue')
            : t('reminder.due', { when: formatMoment(item.dueAt, { midSentence: true, display }) })
        }
      >
        {presetOffsets.map((preset) => {
          const checked = hasOffset(preset.minutes);
          const at = item.dueAt === null ? null : item.dueAt - preset.minutes * 60_000;
          // A reminder that would go off in the past can be removed but not added.
          const unavailable = !checked && (at === null || at <= now);
          return (
            <ListItem
              key={preset.minutes}
              title={offsetLabel(preset.minutes, t)}
              subtitle={at === null ? undefined : at <= now ? t('reminder.passed') : formatMoment(at, { display })}
              subtitleLines={1}
              accessibilityRole="checkbox"
              accessibilityState={{ checked, disabled: unavailable }}
              disabled={unavailable}
              className={cn(unavailable && 'opacity-40')}
              chevron={false}
              trailing={
                <View className="w-6 items-end">
                  {checked ? <Icon icon={Check} tone="accent" strokeWidth={2.25} /> : null}
                </View>
              }
              onPress={() => {
                haptics.selection();
                onToggleOffset(preset.minutes);
              }}
            />
          );
        })}
      </ListGroup>

      <ListGroup header={t('reminder.custom')}>
        {custom.map((reminder) => {
          const at = fireTime(reminder, item);
          const passed = at !== null && at <= now;
          const label = describeReminder(reminder, display);
          return (
            <ListItem
              key={reminder.id}
              title={label}
              subtitle={passed ? t('reminder.passed') : undefined}
              chevron={false}
              trailing={
                <IconButton
                  icon={X}
                  size="sm"
                  accessibilityLabel={t('reminder.removeLabel', { when: label })}
                  onPress={() => onRemove(reminder.id)}
                />
              }
            />
          );
        })}
        {draft ? (
          <DateTimeRow
            label={t('reminder.date')}
            mode="date"
            value={draft}
            minimumDate={new Date(now)}
            onChange={setDraft}
          />
        ) : null}
        {draft ? <DateTimeRow label={t('reminder.time')} mode="time" value={draft} onChange={setDraft} /> : null}
        {draft ? null : (
          <ListItem
            title={t('reminder.chooseTime')}
            accessibilityHint={t('reminder.pickersHint')}
            onPress={() => setDraft(suggestedTime(item, now))}
          />
        )}
      </ListGroup>

      {draft ? (
        <View className="gap-2">
          {draftInPast ? (
            <Text variant="footnote" tone="danger" className="px-4" accessibilityLiveRegion="polite">
              {t('reminder.futureTime')}
            </Text>
          ) : null}
          <View className="flex-row gap-3">
            <Button variant="secondary" className="flex-1" onPress={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              className="flex-1"
              disabled={draftInPast}
              onPress={() => {
                onAddTime(draft.getTime());
                setDraft(null);
              }}
            >
              {t('reminder.add')}
            </Button>
          </View>
        </View>
      ) : null}

      {reminders.length > 0 ? (
        <ListGroup>
          <ListItem title={t('reminder.removeAll')} destructive chevron={false} onPress={onClearAll} />
        </ListGroup>
      ) : null}
    </Sheet>
  );
}
