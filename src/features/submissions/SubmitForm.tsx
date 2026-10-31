import { router, useIsFocused, useNavigation, useRoute } from 'expo-router';
import { CircleCheck, ExternalLink, FilePen, Plus, Puzzle, X } from 'lucide-react-native';
import {
  type ComponentRef,
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AccessibilityInfo, Alert, ScrollView, TextInput, View } from 'react-native';

import type { Assignment } from '@/canvas/api/assignments';
import {
  type NativeSubmissionType,
  submissionFilesPath,
  type SubmitInput,
  useHomeworkTools,
  useSubmissionGroup,
  useSubmitAssignment,
} from '@/canvas/api/submissions';
import { useCanvas } from '@/canvas/session';
import {
  Button,
  Callout,
  Card,
  haptics,
  Icon,
  IconButton,
  IconTile,
  ListGroup,
  ListItem,
  SegmentedControl,
  Text,
  TextField,
} from '@/design';
import { useOpenSignedIn } from '@/features/content/browser';
import { useTranslation, type MessageKey } from '@/i18n';
import { createDateContext, useDisplayTimeZone } from '@/lib/dates';
import { isOnline } from '@/features/offline/connectivity';
import { isBlankHtml, RichEditor } from '@/features/editor/RichEditor';
import { useOnline } from '@/features/offline/useOnline';

import { useDraft } from './drafts';
import { useUploadedDraft } from './useUploadedDraft';
import { GroupCard } from './GroupCard';
import { MediaPanel, useMediaMode } from './MediaSubmission';
import { attemptNote, extensionList, normalizeUrl, submitBlocker, submitOptions } from './rules';
import { type PickedContent, registerToolEditor, beginToolLaunch, revokeToolLaunch } from './toolContent';
import { UploadList } from './UploadList';
import {
  removeUpload,
  uploadsFor,
  mediaSlot,
  submissionSlot,
  summarize,
  useUploads,
} from './uploadStore';
import { useAddFiles } from './useAddFiles';

import {
  confirmation,
  failureText,
  formDate,
  formFailure,
  formRules,
  formTypeLabel,
  type FormFailure,
} from './formPresentation';

const typeLabels: Record<NativeSubmissionType, MessageKey> = {
  online_text_entry: 'submissionForm.text',
  online_upload: 'submissionForm.file',
  online_url: 'submissionForm.website',
  media_recording: 'submissionForm.media',
  student_annotation: 'submissionForm.annotate',
};

type Result = {
  context: object;
  attempt: number;
  submittedAt: Date | null;
  late: boolean;
  group: string | null;
};

/** A tool's link waiting to be submitted as `basic_lti_launch` (ASSIGN-9). */
type ToolLink = Extract<PickedContent, { kind: 'lti' | 'link' }> & { toolName: string };

/**
 * One screen for turning in an assignment (ASSIGN-3 to ASSIGN-7, ASSIGN-9,
 * ASSIGN-13): picks among the allowed types, keeps drafts and uploads safe while
 * the student works, takes picks from tools, confirms (for the whole group on a
 * group assignment), submits, and shows the result.
 */
export function SubmitForm({
  a,
  initialType,
  scrollViewRef,
}: {
  a: Assignment;
  initialType?: string;
  scrollViewRef: RefObject<ComponentRef<typeof ScrollView> | null>;
}) {
  const { account, client } = useCanvas();
  const online = useOnline();
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const dates = createDateContext(locale, zone);
  const presentation = formRules(t, dates);
  const options = submitOptions(a);
  const blocker = submitBlocker(a, new Date(), presentation);
  const [type, setType] = useState<NativeSubmissionType | null>(
    () => options.native.find((t) => t === initialType) ?? options.native[0] ?? null,
  );
  const [result, setResult] = useState<Result | null>(null);
  const [failure, setFailure] = useState<{ context: object; value: FormFailure } | null>(null);
  const [urlError, setUrlError] = useState(false);
  const urlInput = useRef<ComponentRef<typeof TextInput>>(null);
  const [toolLink, setToolLink] = useState<ToolLink | null>(null);

  // Refetching after Submit must not move the old editor/uploads into a new draft attempt.
  const editorKey = JSON.stringify([account.id, a.courseId, a.id]);
  const [editor, setEditor] = useState({
    key: editorKey,
    attempt: (a.submission?.attempt ?? 0) + 1,
  });
  if (editor.key !== editorKey)
    setEditor({ key: editorKey, attempt: (a.submission?.attempt ?? 0) + 1 });
  const draftOptions = {
    client,
    submissionId: a.submission?.id ?? undefined,
    attempt: editor.attempt,
  };
  const text = useDraft(account.id, a.courseId, a.id, 'text', isBlankHtml, draftOptions);
  const url = useDraft(account.id, a.courseId, a.id, 'url', undefined, draftOptions);
  const [comment, setComment] = useState('');

  const slot = submissionSlot(account.id, a.courseId, a.id);
  const uploads = useUploads(slot);
  const files = summarize(uploads);
  const addFiles = useAddFiles({
    slot,
    preflightPath: submissionFilesPath(a.courseId, a.id),
    allowedExtensions: a.allowedExtensions,
    onScan: () => {
      if (!available()) return;
      router.push({
        pathname: '/course/[courseId]/assignment/[assignmentId]/scan',
        params: { courseId: a.courseId, assignmentId: a.id },
      } as never);
    },
  });

  const recording = mediaSlot(account.id, a.courseId, a.id);
  const mediaItems = useUploads(recording);
  const media = summarize(mediaItems);
  const mediaMode = useMediaMode(a);

  const uploadedDraftStatus = useUploadedDraft(
    { accountId: account.id, courseId: a.courseId, assignmentId: a.id, ...draftOptions },
    !toolLink && type === 'online_upload' && !files.uploading && !files.failed
      ? { activeSubmissionType: 'online_upload', fileIds: files.fileIds }
      : !toolLink && type === 'media_recording' && !media.uploading && !media.failed
        ? media.media
          ? { activeSubmissionType: 'media_recording', mediaId: media.media.id }
          : mediaMode.mode === 'file'
            ? { activeSubmissionType: 'online_upload', fileIds: media.fileIds }
            : mediaMode.mode === 'kaltura'
              ? { activeSubmissionType: 'media_recording', mediaId: null }
              : null
        : null,
    !result && !blocker,
  );

  // Tools take any online submission as a link (Assignment#accepts_submission_type?).
  const takesTools = a.submissionTypes.some((t) => t.startsWith('online_'));
  const tools = useHomeworkTools(a.courseId, takesTools && !blocker);
  const group = useSubmissionGroup(a.courseId, a.groupCategoryId);

  const submit = useSubmitAssignment(a.courseId, a.id, draftOptions.attempt);
  const openSignedIn = useOpenSignedIn();
  const accountId = account.id,
    courseId = a.courseId,
    assignmentId = a.id,
    attempt = editor.attempt;
  // Server submission/attempt refreshes are permissions, NOT editor lifetime. Invalidation
  // may refresh them before mutateAsync resolves after consuming this pinned draft.
  const context = useMemo(
    () => ({ accountId, client, courseId, assignmentId, attempt }),
    [accountId, client, courseId, assignmentId, attempt],
  );
  const [postingContext, setPostingContext] = useState<object | null>(null);
  const posting = postingContext === context;
  const toolLaunch = useRef<string | undefined>(undefined);
  const [uiContext, setUiContext] = useState(context);
  if (uiContext !== context) {
    setUiContext(context);
    setResult(null);
    setFailure(null);
    setUrlError(false);
    setComment('');
    setToolLink(null);
    setType(options.native.find((value) => value === initialType) ?? options.native[0] ?? null);
  }
  const view = {
    a,
    online,
    type,
    toolLink,
    text,
    url,
    comment,
    mediaMode,
    group,
    mutate: submit.mutateAsync,
    reset: submit.reset,
    t,
    presentation,
    tools,
  };
  const live = useRef<{
    context: object;
    view: typeof view;
    operation: object | null;
    confirmation: object | null;
    finished: boolean;
    signature: string;
  } | null>(null);
  const signature = JSON.stringify([
    a.kind,
    a.submissionTypes,
    a.locked,
    a.lockExplanation,
    a.lockAt,
    a.canSubmit,
    a.allowedAttempts,
    a.submission?.attempt,
    a.submission?.extraAttempts,
    a.submission?.id,
    a.annotatableAttachmentId,
    a.allowedExtensions,
    a.groupCategoryId,
    a.name,
    a.htmlUrl,
    type,
    toolLink,
    comment,
    text.value,
    url.value,
    text.loaded,
    url.loaded,
    online,
    mediaMode.mode,
    group.data,
    group.isPending,
    group.isError,
    tools.data,
  ]);
  useLayoutEffect(() => {
    live.current = {
      context,
      view: { ...view },
      operation: null,
      confirmation: null,
      finished: false,
      signature,
    };
    return () => {
      if (live.current?.context === context) live.current = null;
    };
    // Lifetime excludes locale, presentation and server refreshes by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);
  useLayoutEffect(() => {
    const state = live.current;
    if (state?.context !== context) return;
    if (state.signature !== signature) state.confirmation = null;
    Object.assign(state, { view: { ...view }, signature });
  });
  const currentState = () => (live.current?.context === context ? live.current : null);
  const eligible = (state: NonNullable<typeof live.current>, submitting = true) => {
    const v = state.view;
    return (
      (!submitting ||
        (v.online &&
          isOnline() &&
          (!v.a.groupCategoryId || (!v.group.isPending && !v.group.isError)))) &&
      submitBlocker(v.a) === null &&
      (v.toolLink
        ? v.a.submissionTypes.some((value) => value.startsWith('online_'))
        : v.type === null
          ? submitOptions(v.a).browser.length > 0
          : submitOptions(v.a).native.includes(v.type)) &&
      (v.toolLink || v.type !== 'online_text_entry' || v.text.loaded) &&
      (v.toolLink || v.type !== 'online_url' || v.url.loaded)
    );
  };
  const available = (submitting = true) => {
    const state = currentState();
    return (
      !!state &&
      state.signature === signature &&
      state.view.type === type &&
      state.view.toolLink === toolLink &&
      !state.operation &&
      !state.finished &&
      !!eligible(state, submitting)
    );
  };
  // Browser entry has its own committed lifetime. It never claims the submit
  // operation or prevents ordinary edits, draft work, annotation or tool launches.
  const navigation = useNavigation();
  const route = useRoute();
  const focused = useIsFocused();
  const routeKey = route.key;
  const accountBaseUrl = account.baseUrl, clientBaseUrl = client.baseUrl;
  const browserMethods = JSON.stringify(options.browser);
  const browserDestination = a.htmlUrl;
  const [browserGeneration, setBrowserGeneration] = useState(0);
  const browserKeys = [context, signature, accountBaseUrl, account.expired, clientBaseUrl,
    navigation, routeKey, focused, browserGeneration, browserMethods];
  type BrowserOwner = { keys: readonly unknown[]; operation: { mayOpen: () => boolean } | null };
  const browserLive = useRef<BrowserOwner | null>(null);
  const browserTickets = useRef(new WeakMap<object, BrowserOwner>());
  const browserTicket = {};
  useLayoutEffect(() => {
    const blur = navigation.addListener('blur', () => {
      browserLive.current = null;
      setBrowserGeneration(value => value + 1);
    });
    const focus = navigation.addListener('focus', () => setBrowserGeneration(value => value + 1));
    return () => {
      blur();
      focus();
      browserLive.current = null;
    };
  }, [navigation]);
  useLayoutEffect(() => {
    if (!browserLive.current ||
      browserKeys.some((value, index) => !Object.is(value, browserLive.current!.keys[index])))
      browserLive.current = { keys: browserKeys, operation: null };
    browserTickets.current.set(browserTicket, browserLive.current);
  });
  const openBrowserMethod = async (browserType: string) => {
    const owner = browserLive.current;
    const current = () => {
      const state = currentState();
      const routes = navigation.getState();
      return !!owner && browserLive.current === owner && browserTickets.current.get(browserTicket) === owner &&
        account.id === accountId && account.baseUrl === accountBaseUrl && !account.expired &&
        client.baseUrl === clientBaseUrl && route.key === routeKey && focused &&
        navigation.isFocused() && routes?.routes[routes.index]?.key === routeKey &&
        available() && !!state && state.view.a.htmlUrl === browserDestination &&
        submitOptions(state.view.a).browser.includes(browserType);
    };
    if (!current() || !owner || owner.operation?.mayOpen()) return;
    const operation = { mayOpen: () => current() && owner.operation === operation };
    owner.operation = operation; // Claim synchronously, before session lookup.
    try {
      await openSignedIn(browserDestination, operation.mayOpen);
    } catch {
      if (operation.mayOpen())
        Alert.alert(currentState()!.view.t('inboxMedia.browserError'));
    } finally {
      if (browserLive.current === owner && owner.operation === operation) owner.operation = null;
    }
  };
  const edit = (change: (v: typeof view) => void) => {
    // Local draft preparation does not require the network or a group roster.
    if (!available(false)) return;
    const state = currentState()!;
    state.confirmation = null;
    change(state.view);
  };
  useLayoutEffect(
    () => registerToolEditor(slot, {
      context,
      accepts: (toolId) => {
        const state = currentState();
        return !!state && !state.operation && !state.confirmation && !state.finished &&
          !!eligible(state) && !!state.view.tools.data?.some(tool => tool.id === toolId);
      },
      receive: (content) => {
        const state = currentState();
        if (!state || state.operation || state.finished || !eligible(state)) return false;
        if (state.confirmation) { state.confirmation = null; return false; }
        if (content.kind === 'file' && !state.view.a.submissionTypes.includes('online_upload')) return false;
        const v = state.view;
        setFailure(null);
        if (content.kind === 'file') {
          v.toolLink = null;
          v.type = 'online_upload';
          setToolLink(null);
          setType('online_upload');
        } else if (content.kind === 'link' && v.a.submissionTypes.includes('online_url')) {
          v.toolLink = null;
          v.type = 'online_url';
          setToolLink(null);
          v.url.setValue(content.url);
          setType('online_url');
        } else {
          v.toolLink = content;
          setToolLink(content);
        }
        return true;
      },
    }),
    // Locale-only renders update live presentation without replacing the receiver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slot, context],
  );

  const input = (v = view, capture = false): SubmitInput | MessageKey => {
    const { a, type, toolLink, mediaMode } = v;
    const textValue = capture ? v.text.captureForClear()?.value : v.text.value;
    const urlValue = capture ? v.url.captureForClear()?.value : v.url.value;
    const selectedUploads = capture ? uploadsFor(slot) : uploads;
    const selectedMedia = capture ? uploadsFor(recording) : mediaItems;
    const files = summarize(selectedUploads),
      media = summarize(selectedMedia);
    if (toolLink)
      return {
        type: 'basic_lti_launch',
        url: toolLink.url,
        resourceLinkLookupUuid: toolLink.kind === 'lti' ? toolLink.lookupUuid : null,
      };
    switch (type) {
      case 'online_text_entry':
        return textValue == null || isBlankHtml(textValue)
          ? 'submissionForm.writeFirst'
          : { type, body: textValue! };
      case 'online_url': {
        const normalized = normalizeUrl(urlValue ?? '');
        return normalized ? { type, url: normalized } : 'submissionForm.urlInvalid';
      }
      case 'online_upload':
        if (!selectedUploads.length) return 'submissionForm.addFirst';
        if (files.uploading) return 'submissionForm.waitFiles';
        if (files.failed) return 'submissionForm.retryFiles';
        return { type, fileIds: files.fileIds };
      case 'media_recording':
        if (mediaMode.mode === 'checking') return 'submissionForm.checking';
        if (mediaMode.mode === 'unknown' || mediaMode.mode === 'unavailable')
          return 'submissionForm.mediaUnavailable';
        if (!selectedMedia.length) return 'submissionForm.recordFirst';
        if (media.uploading) return 'submissionForm.waitMedia';
        if (media.failed) return 'submissionForm.retryMedia';
        if (mediaMode.mode === 'file') return { type: 'online_upload', fileIds: media.fileIds };
        return media.media
          ? { type, mediaId: media.media.id, mediaType: media.media.type }
          : 'submissionForm.recordFirst';
      case 'student_annotation':
        return a.annotatableAttachmentId
          ? { type, annotatableAttachmentId: a.annotatableAttachmentId }
          : 'submissionForm.noDocument';
      default:
        return 'submissionForm.chooseType';
    }
  };

  const current = input();
  const ready = typeof current !== 'string';
  const showsUrlError = type === 'online_url' && !toolLink;
  const footnote = !online
    ? t('submissionForm.offline')
    : typeof current === 'string' && !showsUrlError
      ? t(current)
      : type === 'student_annotation' && !toolLink
        ? [attemptNote(a, presentation), t('submissionForm.annotationNote')]
            .filter(Boolean)
            .join(' ')
        : attemptNote(a, presentation);
  const resubmit = (a.submission?.attempt ?? 0) > 0;
  const myGroup = group.data ?? null;

  // Compare live content again at the Alert callback, including raw values and ordered
  // upload identities (a same-file replacement is still a different selection).
  const capture = (v: typeof view) => {
    const request = input(v, true);
    const items = uploadsFor(v.type === 'media_recording' ? recording : slot).map((item) => ({
      id: item.id,
      status: item.status,
      fileId: item.uploaded?.id,
      mediaId: item.media?.id,
      mediaType: item.media?.type,
    }));
    const rawDraft =
      !v.toolLink && v.type === 'online_text_entry'
        ? v.text.captureForClear()?.value
        : !v.toolLink && v.type === 'online_url'
          ? v.url.captureForClear()?.value
          : null;
    return {
      request,
      items,
      stamp: JSON.stringify([
        request,
        rawDraft,
        items,
        v.comment,
        v.type,
        v.toolLink,
        v.a.groupCategoryId,
        v.group.data,
        v.a.annotatableAttachmentId,
      ]),
    };
  };
  const confirm = () => {
    if (!available()) return;
    const state = currentState()!;
    if (state.confirmation) return;
    const captured = capture(state.view);
    if (typeof captured.request === 'string') {
      if (state.view.type === 'online_url' && !state.view.toolLink) {
        setUrlError(true);
        urlInput.current?.focus();
      }
      return;
    }
    const claim = {};
    state.confirmation = claim;
    const v = state.view,
      translate = v.t,
      request = captured.request;
    const myGroup = v.group.data ?? null;
    const resubmit = (v.a.submission?.attempt ?? 0) > 0;
    const cancel = () => {
      if (currentState() === state && state.confirmation === claim) state.confirmation = null;
    };
    const send = async () => {
      if (currentState() !== state || state.confirmation !== claim || state.operation) return;
      state.confirmation = null;
      if (!eligible(state) || capture(state.view).stamp !== captured.stamp) return;
      const announce = state.view.t;
      state.operation = claim;
      revokeToolLaunch(toolLaunch.current);
      setPostingContext(context);
      setFailure(null);
      const owns = () => currentState() === state && state.operation === claim;
      try {
        const promise = state.view.mutate({ ...request, comment: v.comment });
        // Installed MutationObserver can retarget a pending mutation on setOptions.
        // Detach synchronously; keep progress here. Original hook callbacks still run.
        state.view.reset();
        const detail = await promise;
        if (!owns()) return;
        const postedSlot = v.type === 'media_recording' ? recording : slot;
        if (!v.toolLink && (v.type === 'online_upload' || v.type === 'media_recording')) {
          for (const item of captured.items) {
            if (!owns()) return;
            const posted =
              request.type === 'online_upload'
                ? item.fileId != null && request.fileIds.includes(item.fileId)
                : request.type === 'media_recording' && item.mediaId === request.mediaId;
            if (!posted) continue;
            const remaining = uploadsFor(postedSlot).find((candidate) => candidate.id === item.id);
            if (
              remaining?.status === 'done' &&
              remaining.uploaded?.id === item.fileId &&
              remaining.media?.id === item.mediaId &&
              remaining.media?.type === item.mediaType
            )
              removeUpload(postedSlot, item.id);
          }
        }
        if (!owns()) return;
        // The hook owns consumption of the pinned attempt. Do not clear a newer draft.
        const latest = detail.attempts[0];
        state.finished = true;
        setResult({
          context,
          attempt: latest?.attempt ?? detail.attempt,
          submittedAt: latest?.submittedAt ?? detail.submittedAt ?? new Date(),
          late: latest?.late ?? detail.late,
          group: myGroup?.name ?? null,
        });
        haptics.success();
        AccessibilityInfo.announceForAccessibility(
          myGroup
            ? announce('submissionForm.submittedGroup', { name: myGroup.name })
            : announce('submissionForm.submitted'),
        );
      } catch (error) {
        if (owns()) {
          haptics.error();
          setFailure({ context, value: formFailure(error) });
        }
      } finally {
        if (owns()) {
          state.operation = null;
          setPostingContext(null);
        }
      }
    };
    Alert.alert(
      translate(resubmit ? 'submissionForm.resubmitQuestion' : 'submissionForm.submitQuestion'),
      [
        confirmation(request, v.a, myGroup, v.type === 'media_recording', v.toolLink, translate),
        myGroup ? translate('submissionForm.groupNote') : null,
        attemptNote(v.a, v.presentation),
        resubmit ? translate('submissionForm.historyNote') : null,
      ]
        .filter(Boolean)
        .join(' '),
      [
        { text: translate('submissionForm.cancel'), style: 'cancel', onPress: cancel },
        {
          text: translate(resubmit ? 'submissionForm.resubmit' : 'submissionForm.submit'),
          onPress: send,
        },
      ],
    );
  };
  const openPicker = (toolId: string, toolName: string) => {
    if (!available()) return;
    const launch = beginToolLaunch(slot, context, { accountId, client, courseId, assignmentId, toolId, toolName });
    if (!launch) return;
    toolLaunch.current = launch;
    router.push({
      pathname: '/course/[courseId]/assignment/[assignmentId]/tool-picker',
      params: { courseId: a.courseId, assignmentId: a.id, toolId, toolName, launch },
    } as never);
  };
  const navigate = (action: () => void) => {
    if (available()) action();
  };
  const resultNavigate = (action: () => void) => {
    const state = currentState();
    if (state?.finished && !state.operation) action();
  };
  if (result?.context === context)
    return <Submitted a={a} result={result} navigate={resultNavigate} />;
  if (blocker !== null)
    return (
      <>
        <Header a={a} />
        <Callout tone="warning" title={t('submissionForm.blocked')}>
          {blocker}
        </Callout>
      </>
    );

  const homeworkTools = tools.data ?? [];

  return (
    <>
      <Header a={a} />
      <GroupCard a={a} compact />

      {toolLink ? (
        <Card className="flex-row items-center gap-3">
          <IconTile icon={Puzzle} tone="accent" />
          <View className="flex-1 gap-0.5">
            <Text variant="headline">{toolLink.title ?? t('submissionForm.pick')}</Text>
            <Text variant="subhead" tone="muted">
              {t('submissionForm.fromTool', { name: toolLink.toolName })}
            </Text>
          </View>
          <IconButton
            icon={X}
            accessibilityLabel={t('submissionForm.removePick', { name: toolLink.toolName })}
            onPress={() =>
              edit((v) => {
                v.toolLink = null;
                setToolLink(null);
              })
            }
            disabled={posting}
          />
        </Card>
      ) : null}

      {!toolLink && options.native.length > 1 && type ? (
        <SegmentedControl
          options={options.native.map((t) => ({ value: t, label: view.t(typeLabels[t]) }))}
          value={type}
          onChange={(t) => {
            edit((v) => {
              v.type = t;
              setType(t);
              setFailure(null);
            });
          }}
          accessibilityLabel={t('submissionForm.type')}
        />
      ) : null}

      {!toolLink && type === 'online_text_entry' ? (
        <View className="gap-2">
          {text.loaded ? (
            <RichEditor
              label={t('submissionForm.yourText')}
              placeholder={t('submissionForm.write')}
              value={text.value}
              onChange={(value) => edit((v) => v.text.setValue(value))}
              minHeight={220}
              editable={!posting}
              scrollViewRef={scrollViewRef}
            />
          ) : (
            <View className="h-[270px] rounded-xl bg-surface-sunken" />
          )}
          <DraftStatus label={text.statusLabel} />
        </View>
      ) : null}

      {!toolLink && type === 'online_url' ? (
        <View className="gap-2">
          <TextField
            ref={urlInput}
            label={t('submissionForm.url')}
            placeholder={t('submissionForm.urlPlaceholder')}
            value={url.value}
            onChangeText={(v) => {
              edit((state) => {
                state.url.setValue(v);
                setUrlError(false);
              });
            }}
            error={urlError ? t('submissionForm.urlInvalid') : null}
            helperText={t('submissionForm.urlHelp')}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="URL"
            returnKeyType="done"
            editable={!posting && url.loaded}
          />
          <DraftStatus label={url.statusLabel} />
        </View>
      ) : null}

      {!toolLink && type === 'online_upload' ? (
        <View className="gap-3">
          {addFiles.notice ? (
            <Callout
              tone={addFiles.notice.tone}
              title={addFiles.notice.title}
              action={{
                label: t('submissionForm.dismiss'),
                onPress: () => navigate(addFiles.dismiss),
                accessibilityLabel: t('submissionForm.dismissLabel'),
              }}
            >
              {addFiles.notice.body}
            </Callout>
          ) : null}
          <UploadList slot={slot} items={uploads} disabled={posting} />
          <Button
            variant="tonal"
            leadingIcon={Plus}
            onPress={() => navigate(addFiles.open)}
            disabled={posting}
          >
            {uploads.length ? t('submissionForm.addAnother') : t('submissionForm.addFile')}
          </Button>
          <Text variant="footnote" tone="muted" align="center">
            {a.allowedExtensions.length
              ? t('submissionForm.accepts', {
                  extensions: extensionList(a.allowedExtensions, locale),
                })
              : t('submissionForm.fileSources')}
          </Text>
          {addFiles.sheet}
        </View>
      ) : null}

      {!toolLink && type === 'media_recording' ? (
        <MediaPanel
          a={a}
          slot={recording}
          items={mediaItems}
          mode={mediaMode.mode}
          onRetryCheck={() => navigate(mediaMode.retry)}
          disabled={posting}
        />
      ) : null}

      {!toolLink && type === 'student_annotation' ? (
        <AnnotationPanel a={a} navigate={navigate} disabled={posting} />
      ) : null}

      {type === 'online_upload' || type === 'media_recording' ? (
        <DraftStatus label={uploadedDraftStatus} />
      ) : null}
      {toolLink ? <DraftStatus label={t('submissionForm.pickStatus')} /> : null}

      {type || toolLink ? (
        <TextField
          label={myGroup ? t('submissionForm.commentGroup') : t('submissionForm.comment')}
          placeholder={t('submissionForm.optional')}
          value={comment}
          onChangeText={(value) =>
            edit((v) => {
              v.comment = value;
              setComment(value);
            })
          }
          multiline
          editable={!posting}
        />
      ) : null}

      {failure?.context === context ? (
        <Callout tone="danger" title={t('submissionForm.failureTitle')}>
          {failureText(failure.value, t)}
        </Callout>
      ) : null}

      {type || toolLink ? (
        <View className="gap-2">
          <Button
            size="lg"
            onPress={confirm}
            loading={posting}
            disabled={
              posting ||
              !online ||
              (!ready && !showsUrlError) ||
              (!toolLink && type === 'online_text_entry' && !text.loaded) ||
              (!toolLink && type === 'online_url' && !url.loaded) ||
              (!!a.groupCategoryId && (group.isPending || group.isError))
            }
            accessibilityHint={typeof current === 'string' ? t(current) : undefined}
          >
            {myGroup
              ? resubmit
                ? t('submissionForm.resubmitGroup')
                : t('submissionForm.submitGroup')
              : resubmit
                ? t('submissionForm.resubmit')
                : t('submissionForm.submit')}
          </Button>
          {footnote ? (
            <Text variant="footnote" tone="muted" align="center">
              {footnote}
            </Text>
          ) : null}
        </View>
      ) : null}

      {!toolLink && homeworkTools.length ? (
        <ListGroup header={t('submissionForm.tools')} footer={t('submissionForm.toolsHelp')}>
          {homeworkTools.map((tool) => (
            <ListItem
              key={tool.id}
              leading={<IconTile icon={Puzzle} tone="accent" />}
              title={tool.name}
              subtitle={tool.description ?? tool.domain ?? undefined}
              subtitleLines={2}
              onPress={() => openPicker(tool.id, tool.name)}
              disabled={posting}
            />
          ))}
        </ListGroup>
      ) : null}

      {options.browser.length ? (
        <ListGroup header={options.native.length ? t('submissionForm.otherWays') : undefined}>
          {options.browser.map((browserType) => (
            <ListItem
              key={browserType}
              leading={<Icon icon={ExternalLink} tone="accent" />}
              title={t('submissionForm.browser', { type: formTypeLabel(browserType, t) })}
              subtitle={t('submissionForm.browserHelp')}
              subtitleLines={3}
              chevron={false}
              onPress={() => openBrowserMethod(browserType)}
            />
          ))}
        </ListGroup>
      ) : null}
    </>
  );
}

/** The assignment's document, opened in DocViewer to annotate (ASSIGN-7). */
function AnnotationPanel({
  a,
  navigate,
  disabled,
}: {
  a: Assignment;
  navigate: (action: () => void) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  if (!a.annotatableAttachmentId)
    return (
      <Callout tone="warning" title={t('submissionForm.noDocumentTitle')}>
        {t('submissionForm.noDocumentHelp')}
      </Callout>
    );
  return (
    <Card className="gap-4">
      <View className="flex-row items-center gap-3">
        <IconTile icon={FilePen} tone="accent" />
        <View className="flex-1 gap-0.5">
          <Text variant="headline">{t('submissionForm.annotationTitle')}</Text>
          <Text variant="subhead" tone="muted">
            {t('submissionForm.annotationHelp')}
          </Text>
        </View>
      </View>
      <Button
        variant="tonal"
        disabled={disabled}
        onPress={() =>
          navigate(() =>
            router.push({
              pathname: '/course/[courseId]/assignment/[assignmentId]/annotate',
              params: { courseId: a.courseId, assignmentId: a.id },
            } as never),
          )
        }
      >
        {t('submissionForm.openDocument')}
      </Button>
    </Card>
  );
}

function Header({ a }: { a: Assignment }) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const dates = createDateContext(locale, zone);
  const due = a.dueAt
    ? t('submissionForm.due', { date: formDate(a.dueAt, dates) })
    : t('submissionForm.noDue');
  const late = a.dueAt && a.dueAt < new Date();
  return (
    <View className="gap-1">
      <Text variant="title2" accessibilityRole="header">
        {a.name}
      </Text>
      <Text variant="subhead" tone={late ? 'danger' : 'muted'}>
        {late ? t('submissionForm.lateDue', { due }) : due}
      </Text>
    </View>
  );
}

function DraftStatus({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <Text variant="footnote" tone="muted" className="px-1" accessibilityLiveRegion="polite">
      {label}
    </Text>
  );
}

function Submitted({
  a,
  result,
  navigate,
}: {
  a: Assignment;
  result: Result;
  navigate: (action: () => void) => void;
}) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const dates = createDateContext(locale, zone);
  return (
    <Card className="items-center gap-4 px-6 py-8">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-success-soft">
        <Icon icon={CircleCheck} size={32} tone="success" />
      </View>
      <View className="items-center gap-1">
        <Text variant="title2" align="center" accessibilityRole="header">
          {result.group !== null
            ? t('submissionForm.submittedGroup', { name: result.group })
            : t('submissionForm.submitted')}
        </Text>
        <Text variant="subhead" tone="muted" align="center">
          {[
            t('submissionForm.attempt', {
              number: new Intl.NumberFormat(locale).format(result.attempt),
            }),
            result.submittedAt ? formDate(result.submittedAt, dates) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {result.late ? (
          <Text variant="subhead" tone="warning" align="center">
            {t('submissionForm.lateResult')}
          </Text>
        ) : null}
      </View>
      <View className="w-full gap-2.5">
        <Button
          onPress={() =>
            navigate(() =>
              router.replace({
                pathname: '/course/[courseId]/assignment/[assignmentId]/submission',
                params: { courseId: a.courseId, assignmentId: a.id },
              } as never),
            )
          }
        >
          {t('submissionForm.viewSubmission')}
        </Button>
        <Button variant="secondary" onPress={() => navigate(() => router.back())}>
          {t('submissionForm.done')}
        </Button>
      </View>
    </Card>
  );
}
