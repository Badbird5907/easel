import { useTranslation, type Translate } from '@/i18n';
import { View } from 'react-native';

import type { CalendarSource } from '@/canvas/api/calendar';
import { AccentScope, Button, type Option, OptionGroup, Sheet } from '@/design';

import { calendarColor } from './AgendaRow';

type Props = {
  visible: boolean;
  calendars: CalendarSource[];
  hidden: ReadonlySet<string>;
  onToggle: (code: string) => void;
  onSetHidden: (codes: string[]) => void;
  onClose: () => void;
};

function swatch(source: CalendarSource) {
  const color = calendarColor(source.code, source);
  return color ? (
    <AccentScope color={color}>
      <View className="h-3 w-3 rounded-full bg-accent" />
    </AccentScope>
  ) : (
    <View className="h-3 w-3 rounded-full bg-fg-muted" />
  );
}

function option(source: CalendarSource, t: Translate): Option<string> {
  return {
    value: source.code,
    label:
      source.type === 'user'
        ? t('calendar.personal')
        : source.type === 'course'
          ? source.shortName
          : source.name,
    subtitle:
      source.type === 'course'
        ? source.name
        : source.type === 'user'
          ? t('calendar.personalHelp')
          : t('calendar.group'),
    leading: swatch(source),
  };
}

/** Pick which calendars show on the Calendar tab (CAL-4). Saved per account. */
export function CalendarFilterSheet({ visible, calendars, hidden, onToggle, onSetHidden, onClose }: Props) {
  const { t } = useTranslation();
  const shown = new Set(calendars.map((c) => c.code).filter((code) => !hidden.has(code)));
  const allShown = shown.size === calendars.length;
  const personal = calendars.filter((c) => c.type === 'user');
  const courses = calendars.filter((c) => c.type === 'course');
  const groups = calendars.filter((c) => c.type === 'group');

  return (
    <Sheet visible={visible} title={t('calendar.calendars')} onClose={onClose}>
      <OptionGroup
        options={personal.map((source) => option(source, t))}
        selected={shown}
        onSelect={onToggle}
      />
      {courses.length > 0 ? (
        <OptionGroup
          header={t('calendar.courses')}
          options={courses.map((source) => option(source, t))}
          selected={shown}
          onSelect={onToggle}
        />
      ) : null}
      {groups.length > 0 ? (
        <OptionGroup
          header={t('calendar.groups')}
          options={groups.map((source) => option(source, t))}
          selected={shown}
          onSelect={onToggle}
        />
      ) : null}
      <Button
        variant="secondary"
        className="self-center"
        onPress={() => onSetHidden(allShown ? calendars.map((c) => c.code) : [])}
      >
        {allShown ? t('calendar.hideAll') : t('calendar.showAll')}
      </Button>
    </Sheet>
  );
}
