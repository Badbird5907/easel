import { router, Stack, usePreventRemove, useIsFocused } from 'expo-router';
import { MessageSquareOff } from 'lucide-react-native';
import { type ComponentRef, useRef, useState } from 'react';
import { Alert, type ScrollView, View } from 'react-native';

import {
  type DiscussionContext,
  useCreateTopic,
  useTopicCreation,
} from '@/canvas/api/discussions';
import {
  AccentScope,
  Button,
  Callout,
  deriveAccent,
  EmptyState,
  haptics,
  ListGroup,
  ListItem,
  Screen,
  Switch,
  TextField,
  useTheme,
} from '@/design';
import { DetailSkeleton } from '@/features/course/states';
import { isBlankHtml, RichEditor } from '@/features/editor/RichEditor';
import { useTranslation } from '@/i18n';
import { useContextLabel } from '@/features/groups/context';
import {
  AttachButton,
  AttachmentStatus,
  PendingAttachmentList,
  useAttachmentUploads,
} from '@/features/inbox/attachments';

import { topicRoute } from './TopicView';
import { discussionErrorMessage } from './threadPresentation';

/**
 * Start a discussion (CONTENT-5): title, body, one file where the course
 * allows it, and the options students may set. Post sits in the header so the
 * keyboard never covers it.
 */
export function NewTopicForm({ context }: { context: DiscussionContext }) {
  const { t } = useTranslation();
  const { scheme } = useTheme();
  const label = useContextLabel(context);
  const creation = useTopicCreation(context);
  const create = useCreateTopic();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollProps = { ref: scrollRef } as object;
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
  const [threaded, setThreaded] = useState(true);
  const [requireInitialPost, setRequireInitialPost] = useState(false);
  const [allowRating, setAllowRating] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const focused = useIsFocused();
  const uploads = useAttachmentUploads({
    folderPath: 'unfiled', max: 1,
    owner: {
      resource: JSON.stringify([context.type, context.id]), focused,
      eligible: !!creation.data?.canCreate && !!creation.data?.canAttach && !creation.isPending && !creation.isError && !creation.isPlaceholderData && !create.isPending && !leaving,
    },
  });
  const tint = label.color ? deriveAccent(label.color, scheme).accentFg : undefined;

  const blocked = uploads.uploading || uploads.failed;
  const canPost = !create.isPending && !blocked && !!creation.data?.canCreate;
  const dirty = !leaving && (title.trim().length > 0 || !isBlankHtml(html) || uploads.items.length > 0);

  const allowLeave = usePreventRemove(dirty, ({ repeat }) =>
    Alert.alert(t('discussions.discardTitle'), t('discussions.discardBody'), [
      { text: t('discussions.keepEditing'), style: 'cancel' },
      {
        text: t('discussions.discard'),
        style: 'destructive',
        onPress: () => {
          setLeaving(true);
          repeat();
        },
      },
    ]),
  );

  const post = () => {
    if (!canPost) return;
    if (!title.trim()) {
      setTitleError(true);
      haptics.error();
      return;
    }
    create.mutate(
      {
        context,
        title: title.trim(),
        html: isBlankHtml(html) ? '' : html,
        fileId: uploads.files[0]?.id ?? null,
        threaded,
        requireInitialPost,
        allowRating,
      },
      {
        onSuccess: (topicId) => {
          haptics.success();
          setLeaving(true);
          allowLeave();
          router.replace(topicRoute(context, topicId) as never);
        },
        onError: () => haptics.error(),
      },
    );
  };

  return (
    <AccentScope color={label.color} className="flex-1">
      <Stack.Screen
        options={{
          title: t('discussions.new'),
          ...(tint && { headerTintColor: tint }),
          headerRight: creation.data?.canCreate
            ? () => (
                <AccentScope color={label.color}>
                  <Button size="sm" disabled={!canPost} loading={create.isPending} onPress={post} className="me-2">
                    {t('discussions.post')}
                  </Button>
                </AccentScope>
              )
            : undefined,
        }}
      />
      <Screen {...scrollProps} automaticallyAdjustKeyboardInsets contentClassName="gap-5">
        {creation.isPending ? (
          <DetailSkeleton />
        ) : creation.isError ? (
          <Callout
            tone="danger"
            title={t('discussions.permissionError')}
            action={{ label: t('common.retry'), onPress: () => creation.refetch() }}
          >
            {discussionErrorMessage(creation.error, t)}
          </Callout>
        ) : !creation.data.canCreate ? (
          <EmptyState
            icon={MessageSquareOff}
            title={t('discussions.denied')}
            description={t('discussions.deniedBody', {
              context: label.name ?? t(context.type === 'course' ? 'discussions.thisCourse' : 'discussions.thisGroup'),
            })}
            action={{ label: t('discussions.goBack'), onPress: () => router.back() }}
          />
        ) : (
          <>
            {create.error ? (
              <Callout tone="danger" title={t('discussions.postError')}>
                {discussionErrorMessage(create.error, t)}
              </Callout>
            ) : null}
            <TextField
              label={t('discussions.titleLabel')}
              value={title}
              onChangeText={(value) => {
                setTitle(value);
                setTitleError(false);
              }}
              error={titleError ? t('discussions.titleRequired') : null}
              maxLength={255}
              autoFocus
              returnKeyType="next"
              editable={!create.isPending}
            />
            <RichEditor
              label={t('discussions.message')}
              value={html}
              onChange={setHtml}
              placeholder={t('discussions.placeholder')}
              editable={!create.isPending}
              scrollViewRef={scrollRef}
            />
            {creation.data.canAttach ? (
              <View className="gap-3">
                <PendingAttachmentList uploads={uploads} />
                <AttachButton uploads={uploads} label={t('discussions.attach')} disabled={create.isPending} />
                <AttachmentStatus uploads={uploads} />
              </View>
            ) : null}
            <ListGroup
              header={t('discussions.options')}
              footer={t('discussions.optionsHint')}
            >
              <ListItem
                title={t('discussions.threaded')}
                subtitle={t('discussions.threadedHint')}
                chevron={false}
                trailing={
                  <Switch value={threaded} onValueChange={setThreaded} accessibilityLabel={t('discussions.threaded')} />
                }
              />
              <ListItem
                title={t('discussions.initialPost')}
                subtitle={t('discussions.initialPostHint')}
                chevron={false}
                trailing={
                  <Switch
                    value={requireInitialPost}
                    onValueChange={setRequireInitialPost}
                    accessibilityLabel={t('discussions.initialPost')}
                  />
                }
              />
              <ListItem
                title={t('discussions.likes')}
                chevron={false}
                trailing={<Switch value={allowRating} onValueChange={setAllowRating} accessibilityLabel={t('discussions.likes')} />}
              />
            </ListGroup>
          </>
        )}
      </Screen>
    </AccentScope>
  );
}
