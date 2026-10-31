import { useLocalSearchParams } from 'expo-router';
import { ClipboardCheck, Lock } from 'lucide-react-native';

import { type NewQuiz, type Quiz, type QuizType, useNewQuizzes, useQuizzes } from '@/canvas/api/quizzes';
import { Card, EmptyState, Icon, IconTile, ListGroup, ListItem, Screen, Section } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import {
  type QuizPresentation,
  useQuizOwner,
  useQuizPresentation,
  useQuizRetry,
} from '@/features/quizzes/quizPresentation';
import { pushRoute } from '@/features/course/navigation';
import { ListSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { TabDisabled, useTabGate } from '@/features/course/TabGate';

const sections: { types: QuizType[]; id: 'graded' | 'practice' | 'surveys' }[] = [
  { types: ['assignment'], id: 'graded' },
  { types: ['practice_quiz'], id: 'practice' },
  { types: ['graded_survey', 'survey'], id: 'surveys' },
];

function describe(quiz: Quiz, now: Date, p: QuizPresentation) {
  const when = quiz.dueAt
    ? p.t('quizPresentation.dueDate', { date: p.date(quiz.dueAt, now, true) })
    : quiz.locked && quiz.unlockAt && quiz.unlockAt > now
      ? p.t('quizPresentation.opens', { date: p.date(quiz.unlockAt, now, true) })
      : null;
  const questions = p.t('quizPresentation.questionCount', { count: quiz.questionCount });
  return [when, quiz.type === 'survey' ? null : p.points(quiz.points), questions].filter(Boolean).join(' · ');
}

const time = (d: Date | null) => d?.getTime() ?? Number.MAX_SAFE_INTEGER;

function describeNew(quiz: NewQuiz, now: Date, p: QuizPresentation) {
  const when = quiz.dueAt
    ? p.t('quizPresentation.dueDate', { date: p.date(quiz.dueAt, now, true) })
    : quiz.locked && quiz.unlockAt && quiz.unlockAt > now
      ? p.t('quizPresentation.opens', { date: p.date(quiz.unlockAt, now, true) })
      : null;
  return [when, p.points(quiz.points)].filter(Boolean).join(' · ');
}

/** The course's classic quizzes by type (QUIZ-1). */
export default function QuizzesScreen() {
  const { courseId, fromHome } = useLocalSearchParams<{ courseId: string; fromHome?: string }>();
  const gate = useTabGate(courseId, 'quizzes', fromHome === '1');
  const quizzes = useQuizzes(courseId);
  // New Quizzes live in the Quizzes tool and come from the assignments API (QUIZ-8).
  const newQuizzes = useNewQuizzes(courseId);
  const refreshControl = useRefreshControl([
    ['courses', courseId, 'quizzes'],
    ['courses', courseId, 'quizzes', 'new'],
    ['courses', courseId, 'tabs'],
  ]);
  const p = useQuizPresentation();
  const { t } = p;
  const key = JSON.stringify([courseId]);
  const owner = useQuizOwner(key, { gate, classic: quizzes.data, fresh: newQuizzes.data });
  const retry = useQuizRetry(
    JSON.stringify([courseId, gate !== 'hidden']),
    gate === 'hidden' ? [] : [quizzes.refetch, newQuizzes.refetch],
  );
  const error = quizzes.error ?? newQuizzes.error;
  const pending = quizzes.isPending || newQuizzes.isPending;
  const empty = !quizzes.data?.length && !newQuizzes.data?.length;
  const now = new Date();

  return (
    <CourseScope courseId={courseId} title={t('quizPresentation.title')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        {gate === 'hidden' ? (
          <TabDisabled courseId={courseId} label={t('quizPresentation.title')} />
        ) : (
          <>
            {error ? (
              <LoadError title={t('quizPresentation.loadQuizzes')} error={error} onRetry={retry} />
            ) : null}
            {pending ? <ListSkeleton rows={4} /> : null}
            {!pending && !error && empty ? (
              <Card padding="none">
                <EmptyState
                  icon={ClipboardCheck}
                  title={t('quizPresentation.empty')}
                  description={t('quizPresentation.emptyHelp')}
                />
              </Card>
            ) : (
              sections.map(({ types, id }) => {
                const fresh =
                  id === 'graded'
                    ? [...(newQuizzes.data ?? [])].sort(
                        (a, b) => time(a.dueAt) - time(b.dueAt) || a.title.localeCompare(b.title),
                      )
                    : [];
                const items = (quizzes.data ?? [])
                  .filter((q) => types.includes(q.type))
                  .sort((a, b) => time(a.dueAt) - time(b.dueAt) || a.title.localeCompare(b.title));
                if (items.length === 0 && fresh.length === 0) return null;
                return (
                  <Section key={id} title={t(`quizPresentation.${id}`)}>
                    <ListGroup>
                      {fresh.map((quiz) => {
                        const subtitle = describeNew(quiz, now, p);
                        return (
                          <ListItem
                            key={`new-${quiz.assignmentId}`}
                            leading={
                              <IconTile icon={ClipboardCheck} tone={quiz.locked ? 'neutral' : 'accent'} />
                            }
                            title={quiz.title}
                            subtitle={subtitle || undefined}
                            subtitleLines={1}
                            trailing={quiz.locked ? <Icon icon={Lock} size={16} tone="subtle" /> : undefined}
                            accessibilityLabel={[
                              quiz.title,
                              subtitle,
                              quiz.locked ? t('quizPresentation.locked') : null,
                            ]
                              .filter(Boolean)
                              .join(', ')}
                            onPress={() => {
                              if (!owner.active || owner.current?.gate === 'hidden') return;
                              if (!owner.current?.fresh?.some((q) => q.assignmentId === quiz.assignmentId))
                                return;
                              pushRoute({
                                pathname: '/course/[courseId]/quiz/new/[assignmentId]',
                                params: { courseId, assignmentId: quiz.assignmentId },
                              });
                            }}
                          />
                        );
                      })}
                      {items.map((quiz) => {
                        const subtitle = describe(quiz, now, p);
                        return (
                          <ListItem
                            key={quiz.id}
                            leading={
                              <IconTile icon={ClipboardCheck} tone={quiz.locked ? 'neutral' : 'accent'} />
                            }
                            title={quiz.title}
                            subtitle={subtitle}
                            subtitleLines={1}
                            trailing={quiz.locked ? <Icon icon={Lock} size={16} tone="subtle" /> : undefined}
                            accessibilityLabel={[
                              quiz.title,
                              subtitle,
                              quiz.locked ? t('quizPresentation.locked') : null,
                            ]
                              .filter(Boolean)
                              .join(', ')}
                            onPress={() => {
                              if (!owner.active || owner.current?.gate === 'hidden') return;
                              if (!owner.current?.classic?.some((q) => q.id === quiz.id)) return;
                              pushRoute({
                                pathname: '/course/[courseId]/quiz/[quizId]',
                                params: { courseId, quizId: quiz.id },
                              });
                            }}
                          />
                        );
                      })}
                    </ListGroup>
                  </Section>
                );
              })
            )}
          </>
        )}
      </Screen>
    </CourseScope>
  );
}
