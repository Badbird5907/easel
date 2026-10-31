import { useTranslation } from '@/i18n';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { Blocks, ExternalLink } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, View } from 'react-native';

import { type GlobalTool, useGlobalTools } from '@/canvas/api/lti';
import { useCanvas } from '@/canvas/session';
import {
  Callout,
  Card,
  EmptyState,
  Icon,
  IconTile,
  ListGroup,
  ListItem,
  Screen,
  Skeleton,
  Text,
  useTheme,
} from '@/design';
import { predictOpenMode, useLaunchTool } from '@/features/lti/launch';
import { useToolAction } from '@/features/lti/action';
import { useToolLifetime } from '@/features/lti/lifetime';
import { useToolOpenChoice } from '@/features/lti/ToolOpenChoice';

function ToolIcon({ tool }: { tool: GlobalTool }) {
  const [failed, setFailed] = useState(false);
  if (!tool.iconUrl || failed) return <IconTile icon={Blocks} tone="neutral" />;
  return (
    <View className="h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-surface-sunken">
      <Image
        source={{ uri: tool.iconUrl }}
        style={{ width: 24, height: 24 }}
        contentFit="contain"
        accessible={false}
        onError={() => setFailed(true)}
      />
    </View>
  );
}

function ToolRow({
  tool,
  launching,
  onLaunch,
}: {
  tool: GlobalTool;
  launching: boolean;
  onLaunch: () => void;
}) {
  const { account } = useCanvas();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const fallback = predictOpenMode(tool.name, tool.url, account.baseUrl);
  const { mode, choose, sheet } = useToolOpenChoice(tool.id, tool.name, fallback);
  return (
    <>
      <ListItem
        title={tool.name}
        subtitle={tool.description ?? tool.domain ?? undefined}
        subtitleLines={2}
        leading={<ToolIcon tool={tool} />}
        trailing={
          launching ? (
            <ActivityIndicator color={colors.fgMuted} accessibilityLabel={t('tools.opening', { name: tool.name })} />
          ) : mode === 'browser' ? (
            <Icon icon={ExternalLink} size={18} tone="subtle" />
          ) : undefined
        }
        chevron={!launching && mode === 'app'}
        disabled={launching}
        accessibilityHint={t(mode === 'browser' ? 'tools.opensBrowser' : 'tools.opensApp')}
        accessibilityActions={[{ name: 'choose', label: t('tools.choose') }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'choose') choose();
        }}
        onPress={onLaunch}
        onLongPress={choose}
      />
      {sheet}
    </>
  );
}

/** Each tool keeps its own claim while the parent owns membership/readiness. */
function ToolLaunchRow({ tool, context }: { tool: GlobalTool; context: { active: boolean } }) {
  const launchTool = useLaunchTool();
  const action = useToolAction(
    JSON.stringify([tool.id, tool.accountId, tool.webUrl, tool.url]),
    true,
    context,
  );
  const launching = action.pending;
  const onLaunch = () =>
    action.run((isCurrent) =>
      launchTool(
        {
          toolId: tool.id,
          accountId: tool.accountId ?? undefined,
          launchType: 'global_navigation',
          title: tool.name,
          fallbackUrl: tool.webUrl ?? undefined,
        },
        { isCurrent },
      ),
    );
  return <ToolRow tool={tool} launching={launching} onLaunch={onLaunch} />;
}

/**
 * Tools the school added to Canvas's main menu (LTI-6): Studio, portfolios,
 * library tools. Each launches signed in, where the student chose.
 */
export default function ToolsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tools = useGlobalTools();
  const { account, client } = useCanvas();
  const context = useToolLifetime(
    JSON.stringify([
      account.id, account.baseUrl, tools.isPending, tools.isError,
      tools.data?.map((tool) => [tool.id, tool.accountId, tool.webUrl, tool.url]),
    ]),
    client,
  );
  const refreshAction = useToolAction('refresh', true, context);
  const refreshing = refreshAction.pending;
  const refresh = () => refreshAction.run(() => tools.refetch());

  return (
    <>
      <Stack.Screen options={{ title: t('tools.title') }} />
      <Screen
        contentClassName="gap-6"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        <Text variant="subhead" tone="muted" className="px-1">
          {t('tools.intro')}
        </Text>
        {tools.isPending ? (
          <View className="gap-3">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </View>
        ) : tools.isError && !tools.data ? (
          <Callout
            tone="danger"
            title={t('tools.loadError')}
            action={{ label: t('common.retry'), onPress: () => tools.refetch() }}
          >
            {tools.error.message}
          </Callout>
        ) : tools.data.length === 0 ? (
          <Card variant="outlined" padding="none">
            <EmptyState
              icon={Blocks}
              title={t('tools.empty')}
              description={t('tools.emptyDescription')}
            />
          </Card>
        ) : (
          <ListGroup footer={t('tools.footer')}>
            {tools.data.map((tool) => (
              <ToolLaunchRow
                key={tool.id}
                tool={tool}
                context={context}
              />
            ))}
          </ListGroup>
        )}
      </Screen>
    </>
  );
}
