import { LocalizedText as Text } from '@/i18n/LocalizedText';
import type { Translate } from '@/i18n';
import { useTranslation } from '@/i18n';
import { router } from 'expo-router';
import { CircleCheck, CircleX, GraduationCap } from 'lucide-react-native';
import { useEffect } from 'react';
import { AccessibilityInfo, Alert, View } from 'react-native';
import { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { CanvasError, CanvasNetworkError } from '@/canvas/client';
import { useCourseLookup } from '@/canvas/api/courses';
import {
  type Invitation,
  useAcceptInvitation,
  useCourseInvitations,
  useDeclineInvitation,
  useDismissInvitation,
} from '@/canvas/api/enrollments';
import { AccentScope, Button, Callout, Card, IconTile } from '@/design';
import { AnimatedView } from '@/design/interop';
import { useOnline } from '@/features/offline/useOnline';
import { cn } from '@/lib/cn';

/** How long "Invitation declined" stays before the card goes. */
const DECLINED_MS = 2500;

function failure(error: Error, verb: 'accept' | 'decline', t: Translate) {
  if (error instanceof CanvasError && (error.status === 400 || error.status === 404))
    return {
      title: t('invitation.gone'),
      message: t('invitation.goneHint'),
      gone: true,
    };
  return {
    title: t(verb === 'accept' ? 'invitation.acceptError' : 'invitation.declineError'),
    message: error instanceof CanvasNetworkError ? t('common.connection') : t('invitation.errorHint'),
    gone: false,
  };
}

function InvitationCard({ invitation: i }: { invitation: Invitation }) {
  const { t } = useTranslation();
  const accept = useAcceptInvitation();
  const decline = useDeclineInvitation();
  const dismiss = useDismissInvitation();
  const online = useOnline();
  const ref = { courseId: i.courseId, enrollmentId: i.enrollmentId };
  const label = i.courseCode || i.courseName;

  // A declined card says so briefly, then collapses.
  const declined = i.outcome === 'declined';
  const declinePending = decline.isPending;
  useEffect(() => {
    if (!declined || declinePending) return;
    const timer = setTimeout(() => dismiss(i.enrollmentId), DECLINED_MS);
    return () => clearTimeout(timer);
  }, [declined, declinePending, dismiss, i.enrollmentId]);

  useEffect(() => {
    if (i.outcome === 'accepted')
      AccessibilityInfo.announceForAccessibility(t('invitation.acceptedLabel', { course: label }));
    if (i.outcome === 'declined')
      AccessibilityInfo.announceForAccessibility(t('invitation.declinedLabel', { course: label }));
  }, [i.outcome, label, t]);

  const confirmDecline = () =>
    Alert.alert(t('invitation.confirm', { course: label }), t('invitation.confirmHint'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('invitation.decline'), style: 'destructive', onPress: () => decline.mutate(ref) },
    ]);

  const error = accept.error ?? decline.error;
  const problem = error && !i.outcome ? failure(error, accept.error ? 'accept' : 'decline', t) : null;
  const role = i.builtInRole ? t(`invitation.role.${i.builtInRole}`) : i.role;
  const details = [t('invitation.role', { role }), i.sectionName ?? i.courseCode, i.term?.name]
    .filter(Boolean)
    .join(' · ');

  if (i.outcome === 'accepted') {
    return (
      <Card className="gap-4">
        <View accessibilityLiveRegion="polite" className="flex-row gap-3">
          <IconTile icon={CircleCheck} tone="success" />
          <View className="flex-1 gap-0.5">
            <Text variant="headline">{t('invitation.accepted')}</Text>
            <Text variant="subhead" tone="muted">
              {t('invitation.inCourses', { course: i.courseName })}
            </Text>
          </View>
        </View>
        <View className="flex-row flex-wrap gap-2">
          <Button
            variant="tonal"
            className="grow"
            loading={accept.isPending}
            accessibilityLabel={t('invitation.openLabel', { course: i.courseName })}
            onPress={() => {
              dismiss(i.enrollmentId);
              router.push({ pathname: '/course/[courseId]', params: { courseId: i.courseId } } as never);
            }}
          >
            {t('invitation.open')}
          </Button>
          <Button
            variant="ghost"
            className="grow"
            accessibilityLabel={t('invitation.doneLabel', { course: label })}
            onPress={() => dismiss(i.enrollmentId)}
          >
            {t('common.done')}
          </Button>
        </View>
      </Card>
    );
  }

  if (declined) {
    return (
      <Card>
        <View accessibilityLiveRegion="polite" className="flex-row items-center gap-3">
          <IconTile icon={CircleX} tone="neutral" />
          <Text variant="subhead" tone="muted" className="flex-1">
            {t('invitation.declinedLabel', { course: i.courseName })}
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <Card className="gap-4">
      <View
        accessible
        accessibilityLabel={t('invitation.label', { course: i.courseName, details })}
        className="flex-row gap-3"
      >
        <IconTile icon={GraduationCap} />
        <View className="flex-1 gap-0.5">
          <Text variant="headline">{i.courseName}</Text>
          <Text variant="subhead" tone="muted">
            {details}
          </Text>
        </View>
      </View>
      {problem ? (
        <Callout
          tone="danger"
          title={problem.title}
          action={
            problem.gone
              ? {
                  label: t('common.dismiss'),
                  accessibilityLabel: t('invitation.dismissLabel', { course: label }),
                  onPress: () => dismiss(i.enrollmentId),
                }
              : {
                  label: t('common.retry'),
                  accessibilityLabel: t(accept.error ? 'invitation.retryAccept' : 'invitation.retryDecline', {
                    course: label,
                  }),
                  onPress: () => (accept.error ? accept.mutate(ref) : decline.mutate(ref)),
                }
          }
        >
          {problem.message}
        </Callout>
      ) : null}
      {problem?.gone ? null : (
        <View className="gap-2">
          <View className="flex-row flex-wrap gap-2">
            <Button
              variant="secondary"
              className="grow"
              disabled={!online}
              accessibilityLabel={t('invitation.declineLabel', { course: label })}
              onPress={() => {
                accept.reset();
                confirmDecline();
              }}
            >
              {t('invitation.decline')}
            </Button>
            <Button
              className="grow"
              disabled={!online}
              accessibilityLabel={t('invitation.acceptLabel', { course: label })}
              onPress={() => {
                decline.reset();
                accept.mutate(ref);
              }}
            >
              {t('invitation.accept')}
            </Button>
          </View>
          {!online ? (
            <Text variant="footnote" tone="muted">
              {t('invitation.offline')}
            </Text>
          ) : null}
        </View>
      )}
    </Card>
  );
}

/**
 * Pending course invitations, each with Accept and Decline (HOME-6). Accepting
 * refreshes the dashboard and All courses. Self-contained: it renders nothing
 * while loading, when there are no invitations, or when they can't load, so it
 * can sit near the top of Home with no wrapper:
 *
 *   <CourseInvitations />
 */
export function CourseInvitations({ className }: { className?: string }) {
  const invitations = useCourseInvitations();
  const courseFor = useCourseLookup();
  const list = invitations.data ?? [];
  if (list.length === 0) return null;
  return (
    <View className={cn('gap-3', className)}>
      {list.map((invitation) => (
        <AnimatedView
          key={invitation.enrollmentId}
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(180)}
          layout={LinearTransition.duration(220)}
        >
          {/* Invited courses are rarely on the dashboard yet; the accent stays default then. */}
          <AccentScope color={courseFor(invitation.courseId)?.color}>
            <InvitationCard invitation={invitation} />
          </AccentScope>
        </AnimatedView>
      ))}
    </View>
  );
}
