import { CircleCheck, Flag } from 'lucide-react-native';
import { View } from 'react-native';

import type { AnswerValue, QuizQuestion } from '@/canvas/api/quizzes';
import { htmlToText } from '@/canvas/html';
import { Callout, Card, Icon, ListGroup, ListItem, ProgressBar, Section, Text } from '@/design';

import { useTranslation } from '@/i18n';
import { useQuizControlOwner } from './quizControls';

import { answerState, isAnswerable } from './answers';

/**
 * Before submitting (QUIZ-2): how many questions have answers, and which don't,
 * which are only partly answered, and which are flagged, each a tap away.
 */
export function ReviewPanel({
  questions,
  attemptKey,
  answers,
  flags,
  numbers,
  onGo,
}: {
  questions: QuizQuestion[];
  attemptKey?: string;
  answers: Record<string, AnswerValue>;
  flags: Record<string, boolean>;
  numbers: Map<string, number | null>;
  onGo: (index: number) => void;
}) {
  const { t, locale } = useTranslation();
  const digits = new Intl.NumberFormat(locale, { useGrouping: false });
  const owner = useQuizControlOwner(attemptKey, JSON.stringify(questions.map((q) => q.id)), true, {
    go: onGo,
  });
  const real = questions.map((q, index) => ({ q, index })).filter(({ q }) => isAnswerable(q));
  const states = real.map(({ q, index }) => ({
    q,
    index,
    state: answerState(q, answers[q.id] ?? q.answer),
  }));
  const unanswered = states.filter((s) => s.state === 'unanswered');
  const partial = states.filter((s) => s.state === 'partial');
  const flagged = states.filter((s) => flags[s.q.id]);
  const answered = states.length - unanswered.length;

  const row = ({ q, index }: { q: QuizQuestion; index: number }, detail?: string) => {
    const number = numbers.get(q.id);
    const preview = htmlToText(q.html.replace(/<span class="easel-blank"[^>]*>\d+<\/span>/g, ' ___ '))
      .replace(/\\[()[\]]|\$\$/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 90);
    return (
      <ListItem
        key={q.id}
        title={t('quizControls.question', {
          number: number == null ? String(number) : digits.format(number),
        })}
        subtitle={preview || undefined}
        subtitleLines={1}
        trailing={flags[q.id] ? <Icon icon={Flag} size={16} tone="warning" /> : undefined}
        accessibilityLabel={[
          t('quizControls.question', {
            number: number == null ? String(number) : digits.format(number),
          }),
          detail,
          flags[q.id] ? t('quizControls.flagged') : null,
          preview,
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint={t('quizControls.goHint')}
        onPress={() => owner.go(index)}
      />
    );
  };

  return (
    <View className="gap-6">
      <Card className="gap-3">
        <Text variant="title3" accessibilityRole="header">
          {t('quizControls.reviewTitle')}
        </Text>
        <View
          accessible
          accessibilityLabel={t('quizControls.progressLabel', { answered, total: states.length })}
          className="gap-2"
        >
          <Text variant="body" tabular>
            {t('quizControls.progress', { answered, total: states.length })}
          </Text>
          <ProgressBar value={states.length ? answered / states.length : 1} />
        </View>
      </Card>

      {unanswered.length === 0 && partial.length === 0 ? (
        <Callout tone="success" icon={CircleCheck} title={t('quizControls.complete')}>
          {t('quizControls.completeHelp')}
        </Callout>
      ) : null}

      {unanswered.length ? (
        <Section title={t('quizControls.unanswered')}>
          <ListGroup>{unanswered.map((s) => row(s, t('quizControls.unanswered')))}</ListGroup>
        </Section>
      ) : null}
      {partial.length ? (
        <Section title={t('quizControls.partial')}>
          <ListGroup footer={t('quizControls.partialHelp')}>
            {partial.map((s) => row(s, t('quizControls.partial')))}
          </ListGroup>
        </Section>
      ) : null}
      {flagged.length ? (
        <Section title={t('quizControls.flaggedReview')}>
          <ListGroup>{flagged.map((s) => row(s, t('quizControls.flagged')))}</ListGroup>
        </Section>
      ) : null}
    </View>
  );
}
