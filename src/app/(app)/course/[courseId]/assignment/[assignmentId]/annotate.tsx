import { router, useLocalSearchParams } from 'expo-router';
import { FileWarning } from 'lucide-react-native';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAssignment } from '@/canvas/api/assignments';
import { type AnnotationSession, createAnnotationSession } from '@/canvas/api/submissions';
import { useCanvas } from '@/canvas/session';
import { Button, Divider, EmptyState, Text } from '@/design';
import { sessionUrl } from '@/features/content/browser';
import {
  annotationAttempt,
  annotationFailure,
  useViewerLifetime,
} from '@/features/submissions/annotationViewer';
import { formatNumber, useTranslation } from '@/i18n';
import { CourseScope } from '@/features/course/CourseScope';
import { DetailSkeleton } from '@/features/course/states';
import { AuthenticatedWebView } from '@/features/web/AuthenticatedWebView';
import { useHeaderHeight } from 'expo-router/react-navigation';

/**
 * Canvas DocViewer for a student annotation assignment (ASSIGN-7). Opens the
 * assignment's document through a `canvadoc_session` for the student's draft
 * (or, with `attempt`, a submitted attempt, read only) in the signed-in web
 * view. DocViewer saves annotations as the student makes them; the submit
 * screen turns them in.
 */
export default function AnnotateScreen() {
  const { courseId, assignmentId, attempt } = useLocalSearchParams<{
    courseId: string;
    assignmentId: string;
    attempt?: string;
  }>();
  const { account, client } = useCanvas();
  const { t, locale } = useTranslation();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const assignment = useAssignment(courseId, assignmentId);
  const submissionId = assignment.data?.submission?.id ?? null;
  const parsedAttempt = annotationAttempt(attempt);
  const readOnly = parsedAttempt !== 'draft';
  const accountId = account.id;
  const context = useMemo(
    () => ({ accountId, client, courseId, assignmentId, submissionId, attempt }),
    [accountId, client, courseId, assignmentId, submissionId, attempt],
  );
  const isCurrent = useViewerLifetime(context);
  const requests = useRef<{
    context: typeof context;
    started: boolean;
    pending: boolean;
    claim: object;
  } | null>(null);
  const refreshing = useRef<typeof context | null>(null);
  useLayoutEffect(() => {
    if (requests.current?.context !== context)
      requests.current = { context, started: false, pending: false, claim: {} };
  }, [context]);
  const [result, setResult] = useState<{
    context: typeof context;
    claim: object;
    session: AnnotationSession | null;
    failure: ReturnType<typeof annotationFailure> | null;
  } | null>(null);
  const assignmentError = assignment.isError;
  const requestSession = useCallback(
    (retry = false) => {
      const slot = requests.current;
      if (
        !isCurrent() ||
        slot?.context !== context ||
        slot.pending ||
        (!retry && slot.started) ||
        !submissionId ||
        parsedAttempt === null ||
        assignmentError
      )
        return;
      const claim = {};
      slot.claim = claim;
      slot.started = true;
      slot.pending = true; // Claim synchronously, before React can render a second tap.
      setResult({ context, claim, session: null, failure: null });
      const owns = () => isCurrent() && requests.current === slot && slot.claim === claim;
      void createAnnotationSession(client, submissionId, parsedAttempt)
        .then(
          (session) => {
            if (owns()) setResult({ context, claim, session, failure: null });
          },
          (error: unknown) => {
            if (owns())
              setResult({ context, claim, session: null, failure: annotationFailure(error) });
          },
        )
        .finally(() => {
          if (owns()) slot.pending = false;
        });
    },
    [client, context, isCurrent, submissionId, parsedAttempt, assignmentError],
  );

  // One request per eligible committed context; locale and irrelevant refetches
  // never acquire a new session. Layout replay retains the synchronous claim.
  useEffect(() => {
    requestSession();
  }, [requestSession]);
  const session = result?.context === context ? result.session : null;
  const failure = result?.context === context ? result.failure : null;
  const title =
    typeof parsedAttempt === 'number'
      ? t('annotationViewer.attemptTitle', {
          attempt: formatNumber(parsedAttempt, undefined, locale),
        })
      : t('annotationViewer.annotate');
  const canvasUrl = assignment.data?.htmlUrl;
  const actions = useMemo(
    () => ({ context, canvasUrl, assignmentError, submissionId, result }),
    [context, canvasUrl, assignmentError, submissionId, result],
  );
  const actionsCurrent = useViewerLifetime(actions);
  const current = () =>
    actionsCurrent() &&
    isCurrent() &&
    (result?.context !== context || requests.current?.claim === result.claim);
  const back = () => {
    if (!current()) return;
    if (router.canGoBack()) router.back();
    else
      router.replace({
        pathname: '/course/[courseId]/assignment/[assignmentId]',
        params: { courseId, assignmentId },
      });
  };
  const openBrowser = async () => {
    const claim = result?.claim;
    const owns = () => current() && !!session && requests.current?.claim === claim;
    if (!owns() || !canvasUrl) return;
    const signed = await sessionUrl(client, canvasUrl);
    if (owns()) await WebBrowser.openBrowserAsync(signed);
  };
  const retry = () => {
    if (!current() || parsedAttempt === null) return;
    const slot = requests.current;
    if (!slot || slot.pending) return;
    if (assignmentError || !submissionId) {
      if (refreshing.current === context) return;
      refreshing.current = context;
      const release = () => {
        if (refreshing.current === context) refreshing.current = null;
      };
      void assignment.refetch().then(release, release);
    } else requestSession(true);
  };

  let body;
  if (
    parsedAttempt === null ||
    assignment.isError ||
    failure ||
    (assignment.isSuccess && !submissionId)
  ) {
    body = (
      <EmptyState
        icon={FileWarning}
        title={t('annotationViewer.documentFailed')}
        description={
          parsedAttempt === null
            ? t('annotationViewer.invalidAttempt')
            : failure
              ? t(failure)
              : t(
                  assignment.isError
                    ? 'annotationViewer.assignmentFailed'
                    : 'annotationViewer.noSubmission',
                )
        }
        action={{
          label: t(parsedAttempt === null ? 'annotationViewer.back' : 'annotationViewer.retry'),
          onPress: parsedAttempt === null ? back : retry,
        }}
        className="flex-1 justify-center"
      />
    );
  } else if (!session) {
    body = (
      <View
        className="px-4"
        style={{ paddingTop: (Platform.OS === 'ios' ? headerHeight : 0) + 16 }}
      >
        <DetailSkeleton />
      </View>
    );
  } else {
    body = (
      <AuthenticatedWebView
        url={session.url}
        title="DocViewer"
        courseId={courseId}
        topInset={Platform.OS === 'ios' ? headerHeight : 0}
        onOpenInBrowser={canvasUrl ? openBrowser : undefined}
      />
    );
  }

  return (
    <CourseScope courseId={courseId} title={title}>
      <View className="flex-1 bg-bg">
        <View className="flex-1">{body}</View>
        {!readOnly && session && !assignment.isError ? (
          <View className="bg-bg">
            <Divider />
            <View
              className="flex-row items-center gap-3 px-4 pt-3"
              style={{ paddingBottom: Math.max(insets.bottom, 12) }}
            >
              <Text variant="footnote" tone="muted" className="flex-1">
                {t('annotationViewer.saveNote')}
              </Text>
              <Button size="sm" onPress={back}>
                {t('annotationViewer.done')}
              </Button>
            </View>
          </View>
        ) : null}
      </View>
    </CourseScope>
  );
}
