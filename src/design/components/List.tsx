import { ChevronRight } from 'lucide-react-native';
import { Children, createContext, isValidElement, type ReactNode, use, useState } from 'react';
import { Platform, Pressable, type PressableProps, View } from 'react-native';

import { cn } from '@/lib/cn';

import { withAlpha } from '../theme/color';
import { useTheme } from '../theme/ThemeProvider';
import { layout } from '../tokens/layout';
import { Divider } from './Divider';
import { Icon } from './Icon';
import { Text } from './Text';

const RowPosition = createContext({ first: true });

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
        <Text variant="overline" tone="muted" className="mb-2 px-4">
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
  title: string;
  subtitle?: string;
  /** Icon tile, avatar, or any visual on the left. */
  leading?: ReactNode;
  /** Text on the right, e.g. a setting's current value. */
  value?: string;
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
  trailing,
  chevron,
  subtitleLines = 2,
  destructive,
  onPress,
  className,
  ...props
}: ListItemProps) {
  const { colors } = useTheme();
  const { first } = use(RowPosition);
  const [textInset, setTextInset] = useState<number>(layout.gutter);
  const showChevron = chevron ?? !!onPress;

  const content = (
    <>
      {!first ? (
        <View className="absolute right-0 top-0" style={{ left: textInset }}>
          <Divider />
        </View>
      ) : null}
      {leading}
      <View className="flex-1 gap-0.5 py-3" onLayout={(e) => setTextInset(e.nativeEvent.layout.x)}>
        <Text variant="body" weight="medium" tone={destructive ? 'danger' : 'default'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="subhead" tone="muted" numberOfLines={subtitleLines}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="body" tone="muted" numberOfLines={1} className="max-w-[45%]">
          {value}
        </Text>
      ) : null}
      {trailing}
      {showChevron ? <Icon icon={ChevronRight} size={18} tone="subtle" /> : null}
    </>
  );

  const rowClass = cn('min-h-[52px] flex-row items-center gap-3 px-4', className);

  if (!onPress) {
    return <View className={rowClass}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      android_ripple={{ color: withAlpha(colors.fg, 0.08) }}
      className={cn(rowClass, Platform.OS === 'ios' && 'active:bg-surface-sunken')}
      {...props}
    >
      {content}
    </Pressable>
  );
}
