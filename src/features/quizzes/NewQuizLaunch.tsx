import { Lock } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, Callout, Text } from '@/design';
import { type Fact, FactList } from '@/features/course/FactList';
import { useCanvas } from '@/canvas/session';
import { useTranslation } from '@/i18n';
import { useQuizPresentation } from './quizPresentation';
import { useToolLifetime } from '@/features/lti/lifetime';
import { useLaunchTool } from '@/features/lti/launch';

export type NewQuizLaunchProps = {
  courseId: string;
  assignmentId: string;
  title: string;
  dueAt: Date | null;
  points: number | null;
  locked: boolean;
  lockExplanation: string | null;
  /** Canvas page for "Open in browser" when the launch fails. */
  canvasUrl?: string | null;
  /** Optional route readiness. Module consumers retain the original ready default. */
  ready?: boolean;
  context?: { active: boolean };
};

/**
 * A New Quiz (QUIZ-8): Canvas runs it in the Quizzes tool, so it launches with
 * `launch_type=assessment` in Easel's signed-in web view, with a guard against
 * leaving mid-attempt.
 */
export function NewQuizLaunch({
  courseId,
  assignmentId,
  title,
  dueAt,
  points,
  locked,
  lockExplanation,
  canvasUrl,
  ready = true,
  context,
}: NewQuizLaunchProps) {
  const launchTool = useLaunchTool();
  const { account, client } = useCanvas();
  const { t } = useTranslation();
  const presentation = useQuizPresentation();
  const owner = useToolLifetime(
    JSON.stringify([account.id, courseId, assignmentId, locked, ready, canvasUrl ?? null]),
    client,
    context,
  );
  const [pending, setPending] = useState<object | null>(null);
  const opening = pending !== null && owner.owns(pending);
  const pts = presentation.points(points);
  const facts: Fact[] = [
    {
      label: t('quizPresentation.due'),
      value: dueAt ? presentation.date(dueAt) : t('quizPresentation.noDue'),
    },
  ];

  const open = async () => {
    if (locked || !ready || (context && !context.active)) return;
    const claim = owner.acquire();
    if (!claim) return;
    const live = owner.capture();
    const isCurrent = () => live() && (!context || context.active);
    setPending(claim);
    try {
      await launchTool(
        {
          courseId,
          assignmentId,
          launchType: 'assessment',
          title,
          needsSession: true,
          guard: t('quizEntry.leave'),
          fallbackUrl: canvasUrl ?? undefined,
        },
        { isCurrent },
      );
    } finally {
      if (owner.owns(claim)) {
        setPending(null);
        owner.release(claim);
      }
    }
  };

  return (
    <>
      <View className="gap-2.5">
        <Text variant="title2" accessibilityRole="header">
          {title}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Badge tone={locked ? 'neutral' : 'accent'} icon={locked ? Lock : undefined}>
            {t(locked ? 'quizPresentation.locked' : 'quizPresentation.single')}
          </Badge>
          {pts ? (
            <Text variant="subhead" tone="muted" tabular>
              {pts}
            </Text>
          ) : null}
        </View>
      </View>
      {locked ? (
        <Callout tone="warning" icon={Lock} title={t('quizPresentation.locked')}>
          {lockExplanation ?? t('quizPresentation.lockedHelp')}
        </Callout>
      ) : (
        <View className="gap-2">
          <Button size="lg" loading={opening} disabled={!ready} onPress={open}>
            {t('newQuizLaunch.open')}
          </Button>
          <Text variant="footnote" tone="muted" align="center">
            {t('newQuizLaunch.help')}
          </Text>
        </View>
      )}
      <FactList facts={facts} />
    </>
  );
}
