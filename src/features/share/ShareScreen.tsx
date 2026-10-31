import { router, Stack, useIsFocused, useLocalSearchParams, useNavigation } from 'expo-router';
import { clearSharedPayloads } from 'expo-sharing';
import {
  ExternalLink,
  FolderUp,
  Globe,
  Send,
  Share2,
  SquareArrowOutUpRight,
} from 'lucide-react-native';
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { useCanvas, useSession } from '@/canvas/session';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  IconTile,
  ListGroup,
  ListItem,
  Screen,
  Section,
  Text,
} from '@/design';
import { useTranslation } from '@/i18n';
import { ListSkeleton } from '@/features/course/states';

import { fileCount, firstUrl, kindOf, toSharedContent } from './content';
import { linkTarget, normalizeLink, openLinkTarget } from './links';
import { PasteLink } from './PasteLink';
import { SharedPreview } from './SharedPreview';
import { ShareScreenOwner, shareScreenNoticeBody } from './shareScreenLifetime';
import { useShareIntake } from './useShareIntake';

/** Leaves the share flow: back where the student came from, or Home after a cold start. */
export function leaveShare() {
  clearSharedPayloads();
  if (router.canGoBack()) router.dismissAll();
  else router.replace('/' as never);
}

/**
 * What another app shared with Easel, and what to do with it (ASSIGN-16, SYS-2,
 * SYS-3): submit it to an assignment, keep it in My Files, or open a Canvas
 * link in Easel. Also where a student pastes a Canvas link.
 *
 * `link` (from `easel://open?url=…` or a Canvas path Easel has no screen for)
 * shows like a shared link.
 */
export function ShareScreen() {
  const { account, client } = useCanvas();
  const { t } = useTranslation();
  const focused = useIsFocused();
  const navigation = useNavigation();
  const { accounts } = useSession();
  const { link } = useLocalSearchParams<{ link?: string }>();
  const share = useShareIntake();

  const content = useMemo(() => {
    const shared = toSharedContent(share.sharedPayloads, share.resolvedSharedPayloads);
    if (!shared.files.length && !shared.url && !shared.text && link)
      return { ...shared, url: normalizeLink(link, account.baseUrl) };
    return shared;
  }, [share.sharedPayloads, share.resolvedSharedPayloads, link, account.baseUrl]);

  const owner = useMemo(
    () => new ShareScreenOwner(content, focused, navigation, share.isCurrent),
    // Session scalars retire controls even when an account object is mutated.
    // Locale-only updates keep the same source and valid controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      content,
      account.id,
      account.user.id,
      account.baseUrl,
      account.host,
      client,
      focused,
      navigation,
      share.isCurrent,
    ],
  );
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.retire();
  }, [owner]);
  const controls = useSyncExternalStore(owner.subscribe, owner.getSnapshot);

  const expectedFiles = fileCount(share.sharedPayloads);
  const waitingForFiles = expectedFiles > content.files.length;
  const kind = kindOf(content);
  const linkUrl = content.url ?? firstUrl(content.text);
  const target = linkUrl ? linkTarget(linkUrl, account) : null;
  const nothing = kind === 'none' && !waitingForFiles;

  let body;
  if (waitingForFiles && share.isResolving) {
    body = <ListSkeleton rows={Math.min(expectedFiles, 4)} />;
  } else if (waitingForFiles) {
    body = (
      <Callout tone="danger" title={t('shareScreen.readErrorTitle')}>
        {t('shareScreen.readErrorBody')}
      </Callout>
    );
  } else if (nothing) {
    body = (
      <Card padding="none">
        <EmptyState
          icon={Share2}
          title={t('shareScreen.emptyTitle')}
          description={t('shareScreen.emptyBody')}
        />
      </Card>
    );
  } else {
    body = <SharedPreview content={content} />;
  }

  const ready = !nothing && !waitingForFiles;

  return (
    <>
      <Stack.Screen
        options={{ title: nothing ? t('shareScreen.openTitle') : t('shareScreen.title') }}
      />
      <Screen
        contentClassName="gap-6"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {body}

        {ready ? (
          <View className="gap-3">
            {target?.kind === 'other' ? (
              <Callout tone="info" icon={Globe} title={t('shareScreen.otherTitle')}>
                {shareScreenNoticeBody(target.host, account.host, t)}
              </Callout>
            ) : null}
            <ListGroup>
              {target && target.kind !== 'other' ? (
                <ListItem
                  leading={<IconTile icon={SquareArrowOutUpRight} />}
                  title={t('shareScreen.open')}
                  subtitle={
                    target.kind === 'native'
                      ? t('shareScreen.openNativeHelp')
                      : t('shareScreen.openWebHelp')
                  }
                  onPress={() => owner.enter(controls, () => openLinkTarget(target))}
                />
              ) : null}
              <ListItem
                leading={<IconTile icon={Send} />}
                title={t('shareScreen.submit')}
                subtitle={
                  kind === 'files'
                    ? t('shareScreen.submitFilesHelp')
                    : kind === 'url'
                      ? t('shareScreen.submitUrlHelp')
                      : t('shareScreen.submitTextHelp')
                }
                onPress={() => owner.enter(controls, () => router.push('/share/courses' as never))}
              />
              {kind === 'files' ? (
                <ListItem
                  leading={<IconTile icon={FolderUp} />}
                  title={t('shareScreen.upload')}
                  subtitle={t('shareScreen.uploadHelp')}
                  onPress={() => owner.enter(controls, () => router.push('/share/folder' as never))}
                />
              ) : null}
              {target?.kind === 'other' ? (
                <ListItem
                  leading={<IconTile icon={ExternalLink} tone="neutral" />}
                  title={t('shareScreen.browser')}
                  onPress={() => owner.enter(controls, () => openLinkTarget(target))}
                />
              ) : null}
            </ListGroup>
            {accounts.length > 1 ? (
              <Text variant="footnote" tone="muted" className="px-4">
                {t('shareScreen.accountHelp', { name: account.user.name, school: account.host })}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Section title={nothing ? t('shareScreen.pasteTitle') : t('shareScreen.pasteAlternative')}>
          <PasteLink />
        </Section>

        {!nothing ? (
          <Button variant="ghost" onPress={() => owner.enter(controls, leaveShare)}>
            {t('shareScreen.done')}
          </Button>
        ) : null}
      </Screen>
    </>
  );
}
