import { useTranslation } from '@/i18n';
import NativeDateTimePicker from '@expo/ui/community/datetime-picker';
import { useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { ListItem, useTheme } from '@/design';
import { useDisplayTimeZone } from '@/lib/dates';
import { dateTimeLabelFormatter } from './display';
import { androidPickerValue, mergeAndroidPicker, mergePickerFields } from './pickerDates';

type Props = {
  label: string;
  value: Date;
  mode: 'date' | 'time';
  onChange: (value: Date) => void;
  minimumDate?: Date;
  disabled?: boolean;
  /** Defaults to Canvas; quiet hours explicitly use the device zone. */
  timeZone?: string;
};

/**
 * A list row that edits a date or a time. iOS shows the system's compact picker
 * in the row; Android opens the system picker dialog when the row is tapped.
 * Tinted with the current accent.
 */
export function DateTimeRow({ label, value, mode, onChange, minimumDate, disabled, timeZone }: Props) {
  const { t, locale } = useTranslation();
  const canvasZone = useDisplayTimeZone();
  const zone = timeZone ?? canvasZone;
  const { colors, scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const formatter = useMemo(() => dateTimeLabelFormatter(locale, zone, mode), [locale, zone, mode]);
  const text = formatter.format(value);

  if (Platform.OS === 'ios') {
    return (
      <ListItem
        title={label}
        chevron={false}
        trailing={
          <NativeDateTimePicker
            value={value}
            timeZoneName={zone}
            mode={mode}
            display="compact"
            minimumDate={minimumDate}
            disabled={disabled}
            accentColor={colors.accent}
            themeVariant={scheme}
            onValueChange={(_, picked) => onChange(mergePickerFields(value, picked, mode, timeZone))}
          />
        }
      />
    );
  }

  return (
    <>
      <ListItem
        title={label}
        value={text}
        chevron={false}
        disabled={disabled}
        accessibilityLabel={`${label}, ${text}`}
        accessibilityHint={mode === 'date' ? t('planner.datePickerHint') : t('planner.timePickerHint')}
        onPress={() => setOpen(true)}
      />
      {open ? (
        <NativeDateTimePicker
          key={zone}
          value={androidPickerValue(value, mode, zone)}
          mode={mode}
          presentation="dialog"
          minimumDate={minimumDate ? androidPickerValue(minimumDate, 'date', zone) : undefined}
          accentColor={colors.accent}
          themeVariant={scheme}
          onValueChange={(_, picked) => {
            setOpen(false);
            onChange(mergeAndroidPicker(value, picked, mode, timeZone));
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
