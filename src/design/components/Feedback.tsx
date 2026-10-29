import {
  CircleAlert,
  CircleCheck,
  Info,
  type LucideIcon,
  Sparkles,
  TriangleAlert,
} from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { cn } from '@/lib/cn';

import type { Tone } from '../tokens/colors';
import { Button, type ButtonProps } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

const calloutStyle: Record<Tone, { box: string; icon: LucideIcon }> = {
  accent: { box: 'bg-accent-soft', icon: Sparkles },
  info: { box: 'bg-info-soft', icon: Info },
  success: { box: 'bg-success-soft', icon: CircleCheck },
  warning: { box: 'bg-warning-soft', icon: TriangleAlert },
  danger: { box: 'bg-danger-soft', icon: CircleAlert },
};

export type CalloutProps = {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  icon?: LucideIcon;
  /** Optional trailing action, e.g. "Retry". */
  action?: { label: string; onPress: () => void };
  className?: string;
};

/** Inline message about the content around it: locked modules, late penalties, sync errors. */
export function Callout({ tone = 'info', title, children, icon, action, className }: CalloutProps) {
  const style = calloutStyle[tone];
  return (
    <View
      accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
      className={cn('flex-row gap-3 rounded-2xl p-4', style.box, className)}
      style={{ borderCurve: 'continuous' }}
    >
      <Icon icon={icon ?? style.icon} size={20} tone={tone} />
      <View className="flex-1 gap-0.5">
        {title ? (
          <Text variant="callout" weight="semibold">
            {title}
          </Text>
        ) : null}
        {typeof children === 'string' ? (
          <Text variant="subhead" tone="muted">
            {children}
          </Text>
        ) : (
          children
        )}
        {action ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            onPress={action.onPress}
            className="mt-1.5 self-start active:opacity-60"
          >
            <Text variant="subhead" weight="semibold" tone={tone}>
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: Pick<ButtonProps, 'onPress' | 'leadingIcon'> & { label: string };
  className?: string;
};

/** What a screen shows when there's nothing in it yet. Say why, and what to do next. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <View className={cn('items-center px-8 py-12', className)}>
      <View className="mb-5 h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
        <Icon icon={icon} size={28} tone="accent" />
      </View>
      <Text variant="title3" align="center">
        {title}
      </Text>
      {description ? (
        <Text variant="subhead" tone="muted" align="center" className="mt-1.5 max-w-[300px]">
          {description}
        </Text>
      ) : null}
      {action ? (
        <Button variant="tonal" className="mt-6" leadingIcon={action.leadingIcon} onPress={action.onPress}>
          {action.label}
        </Button>
      ) : null}
    </View>
  );
}
