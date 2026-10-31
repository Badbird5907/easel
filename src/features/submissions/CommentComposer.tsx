import { Mic, Paperclip, SendHorizontal } from 'lucide-react-native';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { commentFilesPath, useAddSubmissionComment } from '@/canvas/api/submissions';
import { CanvasNetworkError } from '@/canvas/client';
import { useCanvas } from '@/canvas/session';
import { Button, Callout, haptics, IconButton, Text, TextField } from '@/design';
import { isOnline } from '@/features/offline/connectivity';
import { useOnline } from '@/features/offline/useOnline';
import { useTranslation } from '@/i18n';

import { AudioRecorderSheet } from './AudioRecorderSheet';
import { useDraft } from './drafts';
import { UploadList } from './UploadList';
import {
  addUploads,
  removeUpload,
  uploadsFor,
  commentSlot,
  summarize,
  useUploads,
} from './uploadStore';
import { useAddFiles } from './useAddFiles';

/**
 * Write a submission comment (ASSIGN-11): text, files, photos, and audio or
 * video recorded in the app. Recordings go up as comment attachments, which
 * every Canvas accepts; media comments need the school's Kaltura setup.
 */
export function CommentComposer({
  courseId,
  assignmentId,
  attempt,
  onFocus,
}: {
  courseId: string;
  assignmentId: string;
  /** The attempt on screen. The comment is filed under it. */
  attempt: number | null;
  /** The comment field gained focus, e.g. to scroll the composer above the keyboard. */
  onFocus?: () => void;
}) {
  const { account, client } = useCanvas();
  const online = useOnline();
  const { t } = useTranslation();
  const draft = useDraft(account.id, courseId, assignmentId, 'comment', undefined, {
    attempt: attempt ?? 0,
  });
  const slot = commentSlot(account.id, courseId, assignmentId);
  const preflightPath = commentFilesPath(courseId, assignmentId);
  const uploads = useUploads(slot);
  const files = summarize(uploads);
  const post = useAddSubmissionComment(courseId, assignmentId);
  const accountId = account.id;
  const context = useMemo(
    () => ({ accountId, client, courseId, assignmentId, attempt }),
    [accountId, client, courseId, assignmentId, attempt],
  );
  const [recordingContext, setRecordingContext] = useState<object | null>(null);
  const [postingContext, setPostingContext] = useState<object | null>(null);
  const [failure, setFailure] = useState<{ context: object; reason: 'network' | 'generic' } | null>(
    null,
  );
  const live = useRef<{
    context: object;
    operation: object | null;
    draft: typeof draft;
    online: boolean;
    mutate: typeof post.mutateAsync;
    reset: typeof post.reset;
    t: typeof t;
  } | null>(null);
  useLayoutEffect(() => {
    live.current = {
      context,
      operation: null,
      draft,
      online,
      mutate: post.mutateAsync,
      reset: post.reset,
      t,
    };
    return () => {
      if (live.current?.context === context) live.current = null;
    };
    // Only a committed context change releases ownership, never a locale/draft render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);
  useLayoutEffect(() => {
    if (live.current?.context === context)
      Object.assign(live.current, {
        draft,
        online,
        mutate: post.mutateAsync,
        reset: post.reset,
        t,
      });
  }, [context, draft, online, post.mutateAsync, post.reset, t]);
  const current = () => (live.current?.context === context ? live.current : null);
  const available = () => {
    const state = current();
    return !!state && !state.operation;
  };
  const recordAudio = () => {
    if (available()) setRecordingContext(context);
  };
  const addFiles = useAddFiles({
    slot,
    preflightPath,
    onRecordAudio: recordAudio,
    allowVideo: true,
  });

  // Progress belongs to this committed context, independently of the detached
  // mutation observer. The synchronous claim also covers pre-render callbacks.
  const posting = postingContext === context;
  const recording = recordingContext === context;
  const hasText = draft.value.trim().length > 0;
  const blockedByFiles = files.uploading > 0 || files.failed > 0;
  const canSend =
    draft.loaded && online && (hasText || files.fileIds.length > 0) && !blockedByFiles && !posting;

  const send = async () => {
    const state = current();
    if (!state || state.operation || !state.draft.loaded || !state.online || !isOnline()) return;
    const captured = state.draft.captureForClear();
    const submittedItems = uploadsFor(slot)
      .filter((item) => item.status === 'done' && item.uploaded)
      .map((item) => ({ id: item.id, fileId: item.uploaded!.id }));
    const latestFiles = summarize(uploadsFor(slot));
    if (
      !captured ||
      latestFiles.uploading ||
      latestFiles.failed ||
      (!captured.value.trim() && !submittedItems.length)
    )
      return;
    const operation = {};
    state.operation = operation;
    setPostingContext(context);
    setFailure(null);
    // One invocation-locale announcement, only for an actual current completion.
    const translate = state.t;
    const owns = () => current() === state && state.operation === operation;
    try {
      const request = state.mutate({
        text: captured.value,
        fileIds: submittedItems.map((item) => item.fileId),
        attempt,
      });
      // Detach the observer before yielding so later hook options cannot retarget
      // this mutation or its cache callbacks. reset() does not cancel the request.
      state.reset();
      await request;
    } catch (error) {
      if (owns()) {
        haptics.error();
        setFailure({
          context,
          reason: error instanceof CanvasNetworkError ? 'network' : 'generic',
        });
        state.operation = null;
        setPostingContext(null);
      }
      return;
    }
    if (!owns()) return;
    captured.clearIfUnchanged();
    for (const item of submittedItems) {
      const remaining = uploadsFor(slot).find((candidate) => candidate.id === item.id);
      if (remaining?.status === 'done' && remaining.uploaded?.id === item.fileId)
        removeUpload(slot, item.id);
    }
    state.operation = null;
    setPostingContext(null);
    haptics.success();
    AccessibilityInfo.announceForAccessibility(translate('commentComposer.posted'));
  };

  return (
    <View className="gap-3">
      <TextField
        placeholder={t('commentComposer.placeholder')}
        accessibilityLabel={t('commentComposer.field')}
        value={draft.value}
        onChangeText={(value) => {
          current()?.draft.setValue(value);
        }}
        multiline
        onFocus={onFocus}
        editable={draft.loaded && !posting}
        helperText={
          files.uploading
            ? t('commentComposer.uploading')
            : files.failed
              ? t('commentComposer.failedAttachments')
              : undefined
        }
      />
      {draft.statusLabel ? (
        <Text variant="footnote" tone="muted">
          {draft.statusLabel}
        </Text>
      ) : null}
      {addFiles.notice ? (
        <Callout
          tone={addFiles.notice.tone}
          title={addFiles.notice.title}
          action={{
            label: t('commentComposer.dismiss'),
            onPress: () => {
              if (available()) addFiles.dismiss();
            },
            accessibilityLabel: t('commentComposer.dismissLabel'),
          }}
        >
          {addFiles.notice.body}
        </Callout>
      ) : null}
      <UploadList slot={slot} items={uploads} disabled={posting} />
      {failure?.context === context ? (
        <Callout tone="danger" title={t('commentComposer.failureTitle')}>
          {t(
            failure.reason === 'network'
              ? 'commentComposer.networkFailure'
              : 'commentComposer.genericFailure',
          )}
        </Callout>
      ) : null}
      <View className="flex-row items-center gap-1">
        <IconButton
          icon={Paperclip}
          variant="secondary"
          accessibilityLabel={t('commentComposer.attach')}
          onPress={() => {
            if (available()) addFiles.open();
          }}
          disabled={posting}
        />
        <IconButton
          icon={Mic}
          variant="secondary"
          accessibilityLabel={t('commentComposer.audio')}
          onPress={recordAudio}
          disabled={posting}
        />
        <View className="flex-1" />
        <Button
          size="sm"
          leadingIcon={SendHorizontal}
          onPress={send}
          disabled={!canSend}
          loading={posting}
          accessibilityHint={!online ? t('commentComposer.offline') : undefined}
        >
          {t('commentComposer.send')}
        </Button>
      </View>
      {addFiles.sheet}
      <AudioRecorderSheet
        visible={recording}
        onClose={() => {
          if (available()) setRecordingContext(null);
        }}
        onAttach={(file) => {
          if (!available()) return;
          setRecordingContext(null);
          addUploads(slot, { client, preflightPath }, [file]);
        }}
      />
    </View>
  );
}
