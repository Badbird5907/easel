import { CircleX, Eye, EyeOff, type LucideIcon, Search } from 'lucide-react-native';
import { type ComponentRef, type Ref, useState } from 'react';
import { Platform, Pressable, TextInput, type TextInputProps, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

import { useTheme } from '../theme/ThemeProvider';
import { fontFamilies, interTracking } from '../tokens/typography';
import { useAnnouncement } from '../accessibility/useAnnouncement';
import { layout } from '../tokens/layout';
import { Icon } from './Icon';
import { Text } from './Text';

const inputText = {
  fontFamily: fontFamilies.regular,
  fontSize: 16,
  letterSpacing: interTracking(16),
  // Explicit line height misaligns single-line TextInput text on iOS, so none here.
  ...(Platform.OS === 'android' && { includeFontPadding: false, paddingVertical: 0 }),
};

export type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  /** Hint below the field. Replaced by `error` when present. */
  helperText?: string;
  error?: string | null;
  leadingIcon?: LucideIcon;
  /** Shows a clear button while there's text. */
  clearable?: boolean;
  className?: string;
  ref?: Ref<ComponentRef<typeof TextInput>>;
};

export function TextField({
  label,
  helperText,
  error,
  leadingIcon,
  clearable,
  secureTextEntry,
  multiline,
  editable = true,
  value,
  onChangeText,
  onFocus,
  onBlur,
  className,
  ref,
  accessibilityHint,
  accessibilityState,
  ...props
}: TextFieldProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const hasValue = !!value && value.length > 0;
  const note = error || helperText;
  const isEditable = props.readOnly === undefined ? editable : !props.readOnly;
  useAnnouncement(error ? t('field.errorAnnouncement', {
    field: label ?? props.accessibilityLabel ?? t('field.fallback'), error,
  }) : null);

  return (
    <View className={cn('gap-1.5', className)}>
      {label ? (
        <Text variant="subhead" weight="medium" tone="muted" className="px-1">
          {label}
        </Text>
      ) : null}
      <View
        className={cn(
          'flex-row items-center gap-2.5 rounded-xl border-[1.5px] border-transparent bg-surface-sunken px-3.5',
          multiline ? 'min-h-28 items-start py-3' : 'min-h-12',
          focused && 'border-accent bg-surface',
          !!error && 'border-danger',
          !isEditable && 'opacity-50',
        )}
        style={{ borderCurve: 'continuous' }}
      >
        {leadingIcon ? <Icon icon={leadingIcon} size={18} tone={focused ? 'accent' : 'subtle'} /> : null}
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          editable={isEditable}
          multiline={multiline}
          secureTextEntry={secureTextEntry && !revealed}
          accessibilityLabel={label}
          accessibilityHint={[error ? t('field.errorHint', { error }) : helperText, accessibilityHint].filter(Boolean).join('. ') || undefined}
          accessibilityState={{ ...accessibilityState, disabled: !isEditable || accessibilityState?.disabled }}
          placeholderTextColor={colors.fgSubtle}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          textAlignVertical={multiline ? 'top' : 'center'}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          className="min-h-12 flex-1 self-stretch py-2 text-fg"
          style={[inputText, multiline && { lineHeight: 24, minHeight: 88 }]}
          {...props}
        />
        {clearable && hasValue && isEditable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label !== undefined || props.accessibilityLabel !== undefined
              ? t('field.clear', { field: label ?? props.accessibilityLabel ?? '' })
              : t('field.clearText')}
            style={{ minWidth: layout.minTouch, minHeight: layout.minTouch }}
            className="items-center justify-center"
            onPress={() => onChangeText?.('')}
          >
            <Icon icon={CircleX} size={18} tone="subtle" />
          </Pressable>
        ) : null}
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            disabled={!isEditable}
            accessibilityState={{ disabled: !isEditable }}
            accessibilityLabel={t(revealed ? 'field.hidePassword' : 'field.showPassword')}
            style={{ minWidth: layout.minTouch, minHeight: layout.minTouch }}
            className="items-center justify-center"
            onPress={() => setRevealed((r) => !r)}
          >
            <Icon icon={revealed ? EyeOff : Eye} size={18} tone="muted" />
          </Pressable>
        ) : null}
      </View>
      {note ? (
        <Text
          variant="footnote"
          tone={error ? 'danger' : 'muted'}
          className="px-1"
          accessibilityLiveRegion={error ? 'polite' : undefined}
        >
          {note}
        </Text>
      ) : null}
    </View>
  );
}

export type SearchFieldProps = Omit<TextInputProps, 'style'> & {
  className?: string;
  ref?: Ref<ComponentRef<typeof TextInput>>;
};

/** Capsule search input with a clear button. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  className,
  ref,
  ...props
}: SearchFieldProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const searchLabel = placeholder ?? t('field.search');
  return (
    <View
      className={cn('min-h-11 flex-row items-center gap-2 rounded-full bg-surface-sunken px-3.5', className)}
    >
      <Icon icon={Search} size={18} tone="subtle" />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        placeholder={searchLabel}
        accessibilityLabel={searchLabel}
        placeholderTextColor={colors.fgSubtle}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        returnKeyType="search"
        autoCorrect={false}
        className="min-h-12 flex-1 self-stretch py-2 text-fg"
        style={inputText}
        {...props}
      />
      {value && props.editable !== false && !props.readOnly ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.clearSearch')}
          style={{ minWidth: layout.minTouch, minHeight: layout.minTouch }}
          className="items-center justify-center"
          onPress={() => onChangeText?.('')}
        >
          <Icon icon={CircleX} size={18} tone="subtle" />
        </Pressable>
      ) : null}
    </View>
  );
}
