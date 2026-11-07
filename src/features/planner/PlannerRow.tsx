import { useTranslation, type Translate } from '@/i18n';
import { Check, CloudUpload, EyeOff, type LucideIcon, RotateCcw } from 'lucide-react-native';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { AnimatedView } from '@/design/interop';

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

/**
 * The action under a swiping row. It covers only the strip the row has uncovered,
 * never the area under the row: the group clips its rounded corners per layer, so
 * any color under the row would show along the anti-aliased corner arcs.
 */
function SwipeAction({
  icon,
  label,
  tone,
  side,
  translation,
  width,
}: {
  icon: LucideIcon;
  label: string;
  tone: 'success' | 'warning';
  /** The physical edge the row uncovers: left when swiped right. */
  side: 'left' | 'right';
  translation: SharedValue<number>;
  width: SharedValue<number>;
}) {
  const { direction } = useTranslation();
  // Slide the full-width strip so its inner edge follows the row's edge.
  const strip = useAnimatedStyle(() => {
    const t = translation.value;
    const shown = side === 'left' ? t > 0 : t < 0;
    const x = side === 'left' ? t - width.value : t + width.value;
    return { opacity: shown ? 1 : 0, transform: [{ translateX: x }] };
  });
  // Counter-slide the label so it stays pinned to the row's outer edge.
  const content = useAnimatedStyle(() => {
    const t = translation.value;
    const x = side === 'left' ? t - width.value : t + width.value;
    return { transform: [{ translateX: -x }] };
  });
  // Justify by physical side: flex-row runs right to left in Arabic.
  const atEnd = (side === 'right') !== (direction === 'rtl');
  return (
    <AnimatedView
      className={cn('absolute inset-0 overflow-hidden', tone === 'success' ? 'bg-success' : 'bg-warning')}
      animatedStyle={strip}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <AnimatedView
        className={cn('flex-1 flex-row items-center gap-2 px-6', atEnd ? 'justify-end' : 'justify-start')}
        animatedStyle={content}
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
      </AnimatedView>
    </AnimatedView>
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
  const translation = useSharedValue(0);
  const width = useSharedValue(0);
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

  const finishSwipe = (right: boolean) => {
    if (right) onToggleDone();
    else onDismiss();
  };
  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-10, 10])
    .onUpdate((event) => {
      translation.value = locked && event.translationX > 0 ? 0 : event.translationX / 1.4;
    })
    .onEnd((event) => {
      const projected = (event.translationX + event.velocityX * 0.05) / 1.4;
      if (projected > 88 && !locked) scheduleOnRN(finishSwipe, true);
      else if (projected < -88) scheduleOnRN(finishSwipe, false);
    })
    .onFinalize(() => {
      // Clamped: an overshoot past zero would flash the opposite action.
      translation.value = withSpring(0, { damping: 24, stiffness: 240, overshootClamping: true });
    });
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translation.value }] }));

  return (
    <View
      style={{ overflow: 'hidden' }}
      onLayout={(event) => {
        width.value = event.nativeEvent.layout.width;
      }}
    >
      {!locked && (
        <SwipeAction
          icon={item.markedComplete ? RotateCcw : Check}
          label={item.markedComplete ? t('planner.notDone') : t('common.done')}
          tone="success"
          side="left"
          translation={translation}
          width={width}
        />
      )}
      <SwipeAction
        icon={EyeOff}
        label={t('common.dismiss')}
        tone="warning"
        side="right"
        translation={translation}
        width={width}
      />
      <GestureDetector gesture={pan}>
        <AnimatedView animatedStyle={rowStyle} style={{ backgroundColor: colors.surface }}>
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
        </AnimatedView>
      </GestureDetector>
    </View>
  );
}
