import { router, Stack, usePreventRemove } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import * as WebBrowser from 'expo-web-browser';
import { Ellipsis, RotateCw } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { Alert, Platform, View } from 'react-native';

import { useCanvas } from '@/canvas/session';
import { useTranslation, type Translate } from '@/i18n';
import { useWebLifetime, useWebLive } from './lifetime';

import { IconButton, useTheme } from '@/design';
import { sessionUrl } from '@/features/content/browser';
import { useActionSheet } from '@/features/files/ActionSheet';
import { isNewQuizzes, launchTarget, type ToolLaunch } from '@/features/lti/launch';
import { type ToolOpenMode, useToolOpenMode } from '@/features/lti/preferences';

import {
  AuthenticatedWebView,
  type AuthenticatedWebViewHandle,
  type WebViewState,
} from './AuthenticatedWebView';

export type WebScreenProps = {
  url: string;
  title?: string;
  guard?: string;
  signed?: boolean;
  launch?: ToolLaunch;
  tool?: { id: string | null; name: string | null };
  courseId?: string;
};

const sameHost = (url: string, baseUrl: string) => {
  try {
    return new URL(url).host === new URL(baseUrl).host;
  } catch {
    return false;
  }
};

/** "Leave this quiz? Your answers are saved…" → a title and a message. */
function splitGuard(guard: string): { title: string; message?: string } {
  const match = guard.match(/^(.+?[?.])\s+(.+)$/);
  return match ? { title: match[1], message: match[2] } : { title: guard };
}

/**
 * The signed-in web view as a pushed screen (`/web`): page title in the header,
 * Reload and "Open in browser", the tool's "Open in" choice, and an optional
 * guard before leaving. iOS uses the native header and its menu; Android uses
 * Easel's header with an options sheet.
 */
export function WebScreen({ url, title, guard, signed, launch, tool, courseId }: WebScreenProps) {
  const { client, account } = useCanvas();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const launchKey = JSON.stringify(
    launch ? Object.entries(launch).sort(([a], [b]) => a.localeCompare(b)) : null,
  );
  const owner = useWebLifetime(
    JSON.stringify([url, signed, courseId, tool?.id, tool?.name, launchKey]),
    client,
    JSON.stringify([account.id, account.baseUrl]),
  );
  const liveLaunch = useWebLive(launch);
  const headerHeight = useHeaderHeight();
  const web = useRef<AuthenticatedWebViewHandle>(null);
  const [storedPage, setPage] = useState<{ owner: typeof owner; page: WebViewState } | null>(null);
  const page = storedPage?.owner === owner ? storedPage.page : null;
  // Page metadata can change while a browser request or menu is open. Only
  // navigation to a different URL invalidates those page-specific actions.
  const navigation = useMemo(() => ({ owner, url: page?.url ?? url }), [owner, page?.url, url]);
  const liveNavigation = useWebLive(navigation);
  const owns = () => owner.active && liveNavigation.current === navigation;
  const { show, sheet } = useActionSheet();
  const toolMode = useToolOpenMode(account.id, tool?.id ?? null, 'app');

  const relaunch = useMemo(
    () =>
      launchKey !== 'null'
        ? async () => {
            if (!owner.active || !liveLaunch.current) throw new Error();
            const result = await launchTarget(client, liveLaunch.current);
            if (!owner.active) throw new Error();
            return result.url;
          }
        : undefined,
    [client, owner, launchKey, liveLaunch],
  );

  const browserClaim = useRef<object | null>(null);
  const openInBrowser = async () => {
    if (!owns() || browserClaim.current === owner) return;
    browserClaim.current = owner;
    const handle = web.current;
    const current = () => owns();
    try {
      let target: string;
      if (launch) {
        target = launch.fallbackUrl
          ? await sessionUrl(client, launch.fallbackUrl)
          : (await launchTarget(client, launch)).url;
      } else {
        const here = handle?.currentUrl() ?? url;
        target = sameHost(here, account.baseUrl) ? await sessionUrl(client, here) : here;
      }
      if (!current()) return;
      await WebBrowser.openBrowserAsync(target);
    } catch {
      if (current())
        Alert.alert(t('web.browserFailed'), t('web.browserHelp'), [{ text: t('common.done') }]);
    } finally {
      if (browserClaim.current === owner) browserClaim.current = null;
    }
  };

  const modeChoice = useMemo(
    () => ({ owner, page, mode: toolMode.mode }),
    [owner, page, toolMode.mode],
  );
  const chosenModes = useRef(new WeakSet<object>());
  const chooseMode = (mode: ToolOpenMode) => {
    if (!owns() || chosenModes.current.has(modeChoice)) return;
    chosenModes.current.add(modeChoice);
    toolMode.setMode(mode);
  };
  const back = () => {
    if (owns()) web.current?.goBack();
  };
  const reload = () => {
    if (owns()) web.current?.reload();
  };

  // Warning copy belongs to a confirmation, not to the embedded web resource.
  const warning = useMemo(() => ({ owner, guard }), [owner, guard]);
  const liveWarning = useWebLive(warning);
  const ownsWarning = () => owner.active && liveWarning.current === warning;
  const [leaving, setLeaving] = useState<typeof warning | null>(null);
  const confirmation = useRef<object | null>(null);
  usePreventRemove(!!guard && leaving !== warning, ({ repeat }) => {
    if (!ownsWarning() || !guard) return;
    const claim = {};
    confirmation.current = claim;
    const { title: heading, message } = splitGuard(guard);
    Alert.alert(heading, message, [
      {
        text: t('web.stay'),
        style: 'cancel',
        onPress: () => {
          if (confirmation.current === claim) confirmation.current = null;
        },
      },
      {
        text: t('web.leave'),
        style: 'destructive',
        onPress: () => {
          if (!ownsWarning() || confirmation.current !== claim) return;
          confirmation.current = null;
          setLeaving(warning);
          repeat();
        },
      },
    ]);
  });

  const headerTitle = title || page?.title || 'Canvas';
  const toolLabel = tool?.name ?? t('web.thisTool');

  const optionLabels = (translate: Translate) => [
    ...(page?.canGoBack ? [translate('web.back')] : []),
    translate('web.browser'),
    ...(tool?.id
      ? [
          translate(toolMode.mode === 'app' ? 'web.alwaysBrowser' : 'web.openEasel', {
            name: tool.name ?? translate('web.thisTool'),
          }),
        ]
      : []),
  ];
  const showOptions = () => {
    if (!owns()) return;
    const actions = [
      ...(page?.canGoBack ? [back] : []),
      openInBrowser,
      ...(tool?.id ? [() => chooseMode(toolMode.mode === 'app' ? 'browser' : 'app')] : []),
    ];
    show({
      title: headerTitle,
      options: optionLabels(t).map((label, i) => ({ label, onPress: actions[i] })),
      presentation: (translate) => ({ title: headerTitle, options: optionLabels(translate) }),
    });
  };

  const iosOptions = {
    unstable_headerRightItems: () => [
      {
        type: 'button' as const,
        label: t('web.reload'),
        icon: { type: 'sfSymbol' as const, name: 'arrow.clockwise' as const },
        accessibilityLabel: t('web.reload'),
        onPress: reload,
      },
      {
        type: 'menu' as const,
        label: t('web.more'),
        icon: { type: 'sfSymbol' as const, name: 'ellipsis' as const },
        accessibilityLabel: t('web.moreOptions'),
        menu: {
          items: [
            ...(page?.canGoBack
              ? [
                  {
                    type: 'action' as const,
                    label: t('web.back'),
                    icon: { type: 'sfSymbol' as const, name: 'chevron.backward' as const },
                    onPress: back,
                  },
                ]
              : []),
            {
              type: 'action' as const,
              label: t('web.browser'),
              icon: { type: 'sfSymbol' as const, name: 'safari' as const },
              onPress: openInBrowser,
            },
            ...(tool?.id
              ? [
                  {
                    type: 'submenu' as const,
                    label: t('web.openIn', { name: toolLabel }),
                    inline: true,
                    items: [
                      {
                        type: 'action' as const,
                        label: 'Easel',
                        state: toolMode.mode === 'app' ? ('on' as const) : ('off' as const),
                        onPress: () => chooseMode('app'),
                      },
                      {
                        type: 'action' as const,
                        label: t('web.browserName'),
                        state: toolMode.mode === 'browser' ? ('on' as const) : ('off' as const),
                        onPress: () => chooseMode('browser'),
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
      },
    ],
  };

  const androidOptions = {
    headerRight: () => (
      <View className="flex-row items-center">
        <IconButton
          icon={RotateCw}
          accessibilityLabel={t('web.reload')}
          iconColor={colors.accentFg}
          onPress={reload}
        />
        <IconButton
          icon={Ellipsis}
          accessibilityLabel={t('web.moreOptions')}
          iconColor={colors.accentFg}
          onPress={showOptions}
        />
      </View>
    ),
  };

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          title: headerTitle,
          ...(guard && { gestureEnabled: false }),
          ...(Platform.OS === 'ios' ? iosOptions : androidOptions),
        }}
      />
      <AuthenticatedWebView
        ref={web}
        resourceIdentity={owner}
        url={url}
        signed={signed}
        relaunch={relaunch}
        title={headerTitle}
        courseId={courseId}
        topInset={Platform.OS === 'ios' ? headerHeight : 0}
        onOpenInBrowser={openInBrowser}
        onStateChange={(next) => {
          if (owner.active) setPage({ owner, page: next });
        }}
        // New Quizzes talks to Canvas from inside its frame; other tools work as the page.
        unwrapToolFrame={Platform.OS === 'android' && !!launch && !isNewQuizzes(tool?.name)}
        onExit={() => {
          if (owner.active) router.back();
        }}
      />
      {sheet}
    </View>
  );
}
