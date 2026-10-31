import { ChevronRight } from 'lucide-react-native';
import { Children, createContext, isValidElement, type ComponentRef, type ReactNode, type Ref, use, useState } from 'react';
import { Platform, Pressable, type PressableProps, useWindowDimensions, View } from 'react-native';

import { cn } from '@/lib/cn';

import { withAlpha } from '../theme/color';
import { useTheme } from '../theme/ThemeProvider';
import { layout } from '../tokens/layout';
import { Divider } from './Divider';
import { Icon } from './Icon';
import { Text } from './Text';

const RowPosition = createContext({ first: true });

/** Matches the row's `gap-3`. */
const ROW_GAP = 12;

export type ListGroupProps = {
  children: ReactNode;
  /** Small uppercase label above the group. */
  header?: string;
  /** Explanatory note below the group. */
  footer?: string;
  className?: string;
};

/**
 * Inset grouped list. Rows draw their own separators, aligned to where their
 * text starts, the way iOS does it.
 */
export function ListGroup({ children, header, footer, className }: ListGroupProps) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View className={className}>
      {header ? (
        <Text accessibilityRole="header" variant="overline" tone="muted" className="mb-2 px-4">
          {header}
        </Text>
      ) : null}
      <View className="overflow-hidden rounded-2xl bg-surface" style={{ borderCurve: 'continuous' }}>
        {rows.map((row, index) => (
          <RowPosition key={row.key ?? index} value={{ first: index === 0 }}>
            {row}
          </RowPosition>
        ))}
      </View>
      {footer ? (
        <Text variant="footnote" tone="muted" className="mt-2 px-4">
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export type ListItemProps = Omit<PressableProps, 'children' | 'style'> & {
  ref?: Ref<ComponentRef<typeof View>>;
  title: string;
  subtitle?: string;
  /** Icon tile, avatar, or any visual on the left. */
  leading?: ReactNode;
  /** Text on the right, e.g. a setting's current value. */
  value?: string;
  /** Align an avatar or icon with the first text line in a multi-line row. */
  leadingAlignment?: 'center' | 'top';
  /** Maximum title lines at standard text sizes. */
  titleLines?: number;
  /** Anything on the right: badge, switch, button. Rendered after `value`. */
  trailing?: ReactNode;
  /** Defaults to true for pressable rows. */
  chevron?: boolean;
  /** Lines of subtitle before truncating. */
  subtitleLines?: number;
  destructive?: boolean;
  className?: string;
};

export function ListItem({
  title,
  subtitle,
  leading,
  value,
  leadingAlignment = 'center',
  titleLines = 2,
  trailing,
  chevron,
  subtitleLines,
  destructive,
  onPress,
  className,
  accessibilityLabel,
  accessibilityState,
  disabled,
  ...props
}: ListItemProps) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > 1.3;
  const { first } = use(RowPosition);
  const [leadingWidth, setLeadingWidth] = useState(0);
  const showChevron = chevron ?? !!onPress;
  // Separators start where the text does. Measuring the leading visual's width
  // (not the text's x) keeps that true when RTL mirrors the row.
  const textInset = layout.gutter + (leading ? leadingWidth + ROW_GAP : 0);

  const content = (
    <>
      {!first ? (
        <View className="absolute top-0" style={{ start: textInset, end: 0 }}>
          <Divider />
        </View>
      ) : null}
      {leading ? (
        <View
          className={!stacked && leadingAlignment === 'top' ? 'self-start pt-3' : undefined}
          onLayout={(e) => setLeadingWidth(e.nativeEvent.layout.width)}
        >
          {leading}
        </View>
      ) : null}
      <View
        className={cn('gap-0.5', stacked ? 'self-stretch' : value ? 'max-w-[45%] shrink py-3' : 'min-w-0 flex-1 py-3')}
      >
        <Text
          numberOfLines={stacked ? undefined : titleLines}
          variant="body"
          weight="medium"
          tone={destructive ? 'danger' : 'default'}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="subhead" tone="muted" numberOfLines={subtitleLines}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          variant="body"
          tone="muted"
          numberOfLines={1}
          ellipsizeMode="tail"
          className={stacked ? 'self-stretch' : 'min-w-0 flex-1 text-right'}
        >
          {value}
        </Text>
      ) : null}
      {trailing}
      {showChevron ? <Icon icon={ChevronRight} size={18} tone="subtle" flipInRTL /> : null}
    </>
  );

  const rowClass = cn('min-h-[52px] gap-3 px-4', stacked ? 'items-start py-3' : 'flex-row items-center', className);

  if (!onPress) {
    return (
      <View className={rowClass} accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || accessibilityState?.disabled}
      accessibilityState={{ ...accessibilityState, disabled: !!(disabled || accessibilityState?.disabled) }}
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: withAlpha(colors.fg, 0.08) }}
      className={cn(rowClass, Platform.OS === 'ios' && 'active:bg-surface-sunken')}
      {...props}
    >
      {content}
    </Pressable>
  );
}
