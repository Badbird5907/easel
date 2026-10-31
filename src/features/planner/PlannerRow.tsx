import { useTranslation, type Translate } from '@/i18n';
import { Check, CloudUpload, EyeOff, type LucideIcon, RotateCcw } from 'lucide-react-native';
import { useRef } from 'react';
import { View } from 'react-native';
import ReanimatedSwipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { isDone, type Course, type WorkItem } from '@/canvas/models';
import { AccentScope, Badge, Icon, ListItem, Text, useTheme } from '@/design';
import { cn } from '@/lib/cn';
import { dayLabel, dueIn, formatTime } from '@/lib/dates';

import { DoneCheckbox } from './DoneCheckbox';
import { kindLabel } from './filters';

type Props = {
  item: WorkItem;
  course?: Course;
  /** Show the day as well as the time, when no group header names it. */
  showDay?: boolean;
  onPress?: () => void;
  onToggleDone: () => void;
  onDismiss: () => void;
  /** A change to this item is waiting for the network (OFF-2). */
  pending?: boolean;
};

/** Done for a reason other than the student's check mark, so the box can't be cleared here. */
function lockedDone(item: WorkItem) {
  return isDone(item) && !item.markedComplete;
}

function statusText(item: WorkItem, t: Translate): string | null {
  if (item.excused) return t('planner.excused');
  if (item.status === 'graded') return t('planner.graded');
  if (item.status === 'submitted') return t('planner.submitted');
  if (item.markedComplete) return t('common.done');
  return null;
}

function Trailing({ item, showDay }: { item: WorkItem; showDay: boolean }) {
  const { t } = useTranslation();
  const status = statusText(item, t);
  if (status) {
    return (
      <Text variant="footnote" tone="muted">
        {status}
      </Text>
    );
  }
  if (item.status === 'missing') return <Badge tone="danger">{t('planner.missing')}</Badge>;
  return (
    <View className="items-end">
      {showDay ? (
        <Text variant="footnote" weight="medium">
          {dayLabel(item.dueAt)}
        </Text>
      ) : null}
      <Text variant={showDay ? 'caption' : 'footnote'} tone="muted" weight="regular" tabular>
        {formatTime(item.dueAt)}
      </Text>
    </View>
  );
}

function SwipeAction({
  icon,
  label,
  tone,
  side,
}: {
  icon: LucideIcon;
  label: string;
  tone: 'success' | 'warning';
  side: 'left' | 'right';
}) {
  return (
    <View
      className={cn(
        'flex-1 flex-row items-center gap-2 px-6',
        tone === 'success' ? 'bg-success' : 'bg-warning',
        side === 'left' ? 'justify-start' : 'justify-end',
      )}
    >
      <Icon icon={icon} size={20} token={tone === 'success' ? 'successContrast' : 'warningContrast'} />
      <Text
        variant="subhead"
        weight="semibold"
        tone="inherit"
        className={tone === 'success' ? 'text-success-contrast' : 'text-warning-contrast'}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * A To Do row: check box in the course color, swipe right to mark done (or not
 * done), swipe left to dismiss. Screen readers get both as custom actions.
 */
export function PlannerRow({
  item,
  course,
  showDay = false,
  onPress,
  onToggleDone,
  onDismiss,
  pending = false,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const swipeable = useRef<SwipeableMethods>(null);
  const locked = lockedDone(item);
  const done = isDone(item);
  const toggleLabel = item.markedComplete ? t('planner.markNotDone') : t('planner.markDone');

  const meta = [
    course?.code ?? item.contextName,
    kindLabel[item.kind] ? t(kindLabel[item.kind]!) : null,
    item.points != null ? t('planner.points', { count: item.points }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const spoken = [
    item.title,
    meta,
    item.status === 'missing' ? t('planner.missing') : null,
    statusText(item, t) ?? t('planner.due', { when: dueIn(item.dueAt) }),
    pending ? t('planner.pending') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={1.4}
      leftThreshold={88}
      rightThreshold={88}
      overshootFriction={8}
      childrenContainerStyle={{ backgroundColor: colors.surface }}
      renderLeftActions={
        locked
          ? undefined
          : () => (
              <SwipeAction
                icon={item.markedComplete ? RotateCcw : Check}
                label={item.markedComplete ? t('planner.notDone') : t('common.done')}
                tone="success"
                side="left"
              />
            )
      }
      renderRightActions={() => (
        <SwipeAction icon={EyeOff} label={t('common.dismiss')} tone="warning" side="right" />
      )}
      onSwipeableWillOpen={(direction) => {
        swipeable.current?.close();
        // Swiping right opens the left panel (done); swiping left opens the right one (dismiss).
        if (direction === SwipeDirection.RIGHT) onToggleDone();
        else onDismiss();
      }}
    >
      <ListItem
        title={item.title}
        subtitle={meta || undefined}
        subtitleLines={1}
        leading={
          <AccentScope color={course?.color}>
            <DoneCheckbox checked={done} locked={locked} onToggle={onToggleDone} />
          </AccentScope>
        }
        trailing={
          pending ? (
            <View className="flex-row items-center gap-2">
              <Icon icon={CloudUpload} size={16} tone="muted" />
              <Trailing item={item} showDay={showDay} />
            </View>
          ) : (
            <Trailing item={item} showDay={showDay} />
          )
        }
        chevron={false}
        onPress={onPress}
        accessibilityLabel={spoken}
        accessibilityHint={onPress ? t('planner.openHint') : undefined}
        accessibilityActions={[
          ...(locked ? [] : [{ name: 'toggle', label: toggleLabel }]),
          { name: 'dismiss', label: t('common.dismiss') },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'toggle') onToggleDone();
          if (event.nativeEvent.actionName === 'dismiss') onDismiss();
        }}
      />
    </ReanimatedSwipeable>
  );
}
