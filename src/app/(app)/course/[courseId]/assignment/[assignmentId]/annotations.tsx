import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { FileWarning } from 'lucide-react-native';
import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { useCanvas } from '@/canvas/session';
import { EmptyState } from '@/design';
import { sessionUrl } from '@/features/content/browser';
import { CourseScope } from '@/features/course/CourseScope';
import { DocViewerPreview } from '@/features/files/previews/WebPreviews';
import { useViewerLifetime } from '@/features/submissions/annotationViewer';
import { useTranslation } from '@/i18n';
import {
  claimFeedback,
  feedbackDocument,
  expireFeedbackViewer,
  revokeFeedback,
  subscribeFeedback,
} from '@/features/submissions/feedbackLaunch';

/** Submitted feedback arrives already signed: never rebind it to a new identity. */
export default function AnnotationsScreen() {
  const {
    courseId,
    assignmentId,
    launch,
    url: rawUrl,
    title: rawTitle,
    canvasUrl: rawCanvasUrl,
    attempt: rawAttempt,
    fileId: rawFileId,
  } = useLocalSearchParams<{
    courseId: string;
    assignmentId: string;
    launch?: string;
    url?: string;
    title?: string;
    canvasUrl?: string;
    attempt?: string;
    fileId?: string;
  }>();
  const { account, client } = useCanvas();
  const { t } = useTranslation();
  const accountId = account.id;
  const [origin] = useState(() => ({ accountId, client }));
  const [viewer] = useState(() => ({}));
  const ownerMatches = origin.accountId === accountId && origin.client === client;
  const context = useMemo(
    () => ({
      accountId,
      client,
      courseId,
      assignmentId,
      launch,
      rawUrl,
      rawTitle,
      rawCanvasUrl,
      rawAttempt,
      rawFileId,
    }),
    [
      accountId,
      client,
      courseId,
      assignmentId,
      launch,
      rawUrl,
      rawTitle,
      rawCanvasUrl,
      rawAttempt,
      rawFileId,
    ],
  );
  const current = useViewerLifetime(context);
  const clean =
    rawUrl === undefined &&
    rawTitle === undefined &&
    rawCanvasUrl === undefined &&
    rawAttempt === undefined &&
    rawFileId === undefined;
  // The snapshot is the document itself, rather than an unused revision. This
  // makes registry changes explicit render inputs even under memoization.
  const document = useSyncExternalStore(
    subscribeFeedback,
    () => (ownerMatches && clean ? feedbackDocument(launch, context, viewer) : null),
    () => null,
  );
  useLayoutEffect(() => {
    if (!ownerMatches) expireFeedbackViewer(viewer);
    else if (clean) claimFeedback(launch, context, viewer);
    return () => {
      // Replay may reattach the same committed context. A real unmount cannot
      // use callbacks during this microtask, and a different viewer cannot claim.
      Promise.resolve().then(() => {
        if (!current() && typeof launch === 'string') revokeFeedback(launch, viewer);
      });
    };
  }, [context, current, launch, viewer, ownerMatches, clean]);
  const blocked = !document;
  const { url, title, canvasUrl } = document ?? {};
  const owned = () => current() && !!feedbackDocument(launch, context, viewer) && !blocked;
  const [failed, setFailed] = useState<typeof context | null>(null);
  const openBrowser = async () => {
    if (!owned() || !canvasUrl) return;
    const signed = await sessionUrl(client, canvasUrl);
    if (owned()) await WebBrowser.openBrowserAsync(signed);
  };
  const back = () => {
    if (!current()) return;
    if (router.canGoBack()) router.back();
    else
      router.replace({
        pathname: '/course/[courseId]/assignment/[assignmentId]',
        params: { courseId, assignmentId },
      });
  };

  return (
    <CourseScope
      courseId={courseId}
      title={blocked ? t('annotationViewer.feedback') : (title ?? t('annotationViewer.feedback'))}
    >
      <View className="flex-1 bg-bg">
        {blocked || failed === context || !url ? (
          <EmptyState
            icon={FileWarning}
            title={t(blocked ? 'annotationViewer.expired' : 'annotationViewer.previewFailed')}
            description={t(
              blocked ? 'annotationViewer.expiredHelp' : 'annotationViewer.previewHelp',
            )}
            action={
              blocked || !canvasUrl
                ? { label: t('annotationViewer.back'), onPress: back }
                : { label: t('annotationViewer.browser'), onPress: openBrowser }
            }
            className="flex-1 justify-center"
          />
        ) : (
          <DocViewerPreview
            key={url}
            url={url}
            title={title ?? t('annotationViewer.document')}
            onError={() => {
              if (owned()) setFailed(context);
            }}
          />
        )}
      </View>
    </CourseScope>
  );
}
