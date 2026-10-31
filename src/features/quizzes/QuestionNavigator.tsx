import { Flag, Info } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import type { AnswerValue, QuizQuestion } from '@/canvas/api/quizzes';
import { Button, haptics, Icon, Sheet, Text } from '@/design';
import { useTranslation } from '@/i18n';
import { useQuizControlOwner } from './quizControls';
import { cn } from '@/lib/cn';

import { answerState, type AnswerState } from './answers';

const stateLabel: Record<
  AnswerState,
  'quizControls.answered' | 'quizControls.partial' | 'quizControls.unanswered'
> = {
  answered: 'quizControls.answered',
  partial: 'quizControls.partial',
  unanswered: 'quizControls.unanswered',
};

/**
 * Every question at a glance (QUIZ-2): answered ones fill in, partly answered
 * ones tint, flagged ones carry a flag, and the current one is outlined. Tap
 * to jump.
 */
export function QuestionNavigator({
  visible,
  attemptKey,
  onClose,
  questions,
  answers,
  flags,
  numbers,
  current,
  onGo,
  onReview,
}: {
  visible: boolean;
  attemptKey?: string;
  onClose: () => void;
  questions: QuizQuestion[];
  answers: Record<string, AnswerValue>;
  flags: Record<string, boolean>;
  numbers: Map<string, number | null>;
  current: number;
  onGo: (index: number) => void;
  onReview: () => void;
}) {
  const { t, locale } = useTranslation();
  const digits = new Intl.NumberFormat(locale, { useGrouping: false });
  const owner = useQuizControlOwner(attemptKey, JSON.stringify(questions.map((q) => q.id)), visible, {
    go: onGo,
    close: onClose,
    review: onReview,
  });
  return (
    <Sheet visible={visible} title={t('quizPresentation.questions')} onClose={() => owner.close()}>
      <View className="flex-row flex-wrap gap-2.5 px-1" accessibilityRole="list">
        {questions.map((q, index) => {
          const number = numbers.get(q.id) ?? null;
          const state = number === null ? null : answerState(q, answers[q.id] ?? q.answer);
          const flagged = !!flags[q.id];
          const isCurrent = index === current;
          const label =
            number === null
              ? [t('quizControls.information'), isCurrent ? t('quizControls.current') : null]
                  .filter(Boolean)
                  .join(', ')
              : [
                  t('quizControls.question', { number: digits.format(number) }),
                  t(stateLabel[state!]),
                  flagged ? t('quizControls.flagged') : null,
                  isCurrent ? t('quizControls.current') : null,
                ]
                  .filter(Boolean)
                  .join(', ');
          return (
            <Pressable
              key={q.id}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: isCurrent }}
              onPress={() => {
                owner.go(index, haptics.selection);
              }}
              className={cn(
                'h-[52px] w-[52px] items-center justify-center rounded-xl',
                state === 'answered'
                  ? 'bg-accent'
                  : state === 'partial'
                    ? 'bg-accent-soft'
                    : number === null
                      ? 'bg-surface-sunken'
                      : 'border-[1.5px] border-border-strong bg-surface',
                isCurrent && 'border-[2.5px] border-fg',
              )}
              style={{ borderCurve: 'continuous' }}
            >
              {number === null ? (
                <Icon icon={Info} size={18} tone="muted" />
              ) : (
                <Text
                  variant="headline"
                  tabular
                  tone={state === 'answered' ? 'onAccent' : state === 'partial' ? 'accent' : 'default'}
                >
                  {digits.format(number)}
                </Text>
              )}
              {flagged ? (
                <View className="absolute -end-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full bg-warning">
                  <Icon icon={Flag} size={11} token="warningContrast" strokeWidth={2.5} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View
        className="flex-row flex-wrap gap-x-4 gap-y-2 px-1"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <Legend swatch="bg-accent" label={t('quizControls.answered')} />
        <Legend swatch="bg-accent-soft" label={t('quizControls.partial')} />
        <Legend
          swatch="border-[1.5px] border-border-strong bg-surface"
          label={t('quizControls.unanswered')}
        />
        <View className="flex-row items-center gap-1.5">
          <View className="h-4 w-4 items-center justify-center rounded-full bg-warning">
            <Icon icon={Flag} size={9} token="warningContrast" strokeWidth={2.5} />
          </View>
          <Text variant="footnote" tone="muted">
            {t('quizControls.flagged')}
          </Text>
        </View>
      </View>

      <Button size="lg" onPress={() => owner.review()}>
        {t('quizControls.reviewSubmit')}
      </Button>
    </Sheet>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View className={cn('h-4 w-4 rounded', swatch)} />
      <Text variant="footnote" tone="muted">
        {label}
      </Text>
    </View>
  );
}
