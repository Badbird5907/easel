import { Clock, EyeOff } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable } from 'react-native';
import {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { haptics, Icon, Text, useReduceMotion } from '@/design';
import { AnimatedView } from '@/design/interop';
import { useTranslation, type Translate } from '@/i18n';
import { useQuizControlOwner } from './quizControls';
import { cn } from '@/lib/cn';

/** 1:05:09, 12:04, 0:42. Multi-day limits read 2d 3h rather than 51:00:00. */
export function formatClock(seconds: number): string {
  if (Number.isFinite(seconds) && seconds >= 86400) {
    const days = Math.floor(seconds / 86400);
    return `${days}d ${Math.floor((seconds % 86400) / 3600)}h`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Spoken time left at minute precision, so the label doesn't change every second. */
export function spokenTimeLeft(seconds: number): string {
  if (seconds <= 0) return 'Time is up';
  if (seconds < 60) return `Less than a minute left`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} ${h === 1 ? 'hour' : 'hours'}${m ? ` ${m} ${m === 1 ? 'minute' : 'minutes'}` : ''} left`;
}

/** Digit substitution preserves the legacy clock's exact arithmetic and padding. */
export function localizedClock(seconds: number, locale: string): string {
  const digits = new Intl.NumberFormat(locale, { useGrouping: false });
  return formatClock(seconds).replace(/[0-9]/g, (digit) => digits.format(Number(digit)));
}

export function localizedTimeLeft(seconds: number, t: Translate): string {
  if (seconds <= 0) return t('quizControls.timeUp');
  if (seconds < 60) return t('quizControls.lessThanMinute');
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return t('quizControls.minutesLeft', { count: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = t('quizPresentation.hours', { count: h });
  return m
    ? t('quizControls.hoursMinutesLeft', { hours, minutes: t('quizPresentation.minutes', { count: m }) })
    : t('quizControls.hoursLeft', { hours });
}

const ANNOUNCE_AT = [600, 300, 60, 30];

/**
 * Time left on the attempt, from Canvas's clock. Turns amber at five minutes
 * and red at one. In the last minute it pulses gently, unless Reduce Motion is
 * on. Tapping hides the numbers (as the web's "Hide" does) for students who
 * find a running clock distracting. VoiceOver and TalkBack hear the time at
 * ten, five, and one minute, and at 30 seconds.
 */
export function QuizTimer({ seconds, attemptKey }: { seconds: number; attemptKey?: string }) {
  const { t, locale } = useTranslation();
  const reduceMotion = useReduceMotion();
  const owner = useQuizControlOwner(attemptKey);
  const [visibility, setVisibility] = useState({ owner, hidden: false });
  const hidden = visibility.owner === owner && visibility.hidden;
  const pulse = useSharedValue(1);
  const urgent = seconds <= 60;
  const warning = seconds <= 300;

  useEffect(() => {
    for (const mark of ANNOUNCE_AT) {
      if (seconds <= mark && seconds > mark - 5 && owner.announce(mark)) {
        AccessibilityInfo.announceForAccessibility(localizedTimeLeft(seconds, t));
        if (mark <= 60) haptics.warning();
      }
    }
  }, [seconds, t, owner]);

  const pulsing = urgent && !reduceMotion && seconds > 0;
  useEffect(() => {
    if (pulsing) {
      pulse.set(
        withRepeat(
          withSequence(withTiming(0.55, { duration: 700 }), withTiming(1, { duration: 700 })),
          -1,
        ),
      );
    } else {
      cancelAnimation(pulse);
      pulse.set(1);
    }
    return () => {
      cancelAnimation(pulse);
      pulse.set(1);
    };
  }, [pulsing, pulse, owner]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  const tone = urgent ? 'danger' : warning ? 'warning' : 'default';
  return (
    <Pressable
      accessibilityRole="timer"
      accessibilityLabel={hidden ? t('quizControls.timerHidden') : localizedTimeLeft(seconds, t)}
      accessibilityHint={hidden ? t('quizControls.showHint') : t('quizControls.hideHint')}
      onPress={() => {
        if (owner.active)
          setVisibility((previous) => ({
            owner,
            hidden: previous.owner === owner ? !previous.hidden : true,
          }));
      }}
      hitSlop={6}
      className={cn(
        'min-h-11 flex-row items-center gap-1.5 rounded-full px-3.5',
        urgent ? 'bg-danger-soft' : warning ? 'bg-warning-soft' : 'bg-surface-sunken',
      )}
    >
      <AnimatedView className="flex-row items-center gap-1.5" animatedStyle={pulseStyle}>
        <Icon icon={hidden ? EyeOff : Clock} size={16} tone={tone} strokeWidth={2.25} />
        <Text variant="callout" weight="semibold" tone={tone} tabular>
          {hidden ? t('quizControls.showTime') : localizedClock(seconds, locale)}
        </Text>
      </AnimatedView>
    </Pressable>
  );
}
