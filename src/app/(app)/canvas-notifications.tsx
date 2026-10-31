import { useTranslation } from '@/i18n';
import { preferenceText, preferenceGroupId, preferenceGroupTitle, frequencyLabel } from '@/features/notifications/preferenceDisplay';
import { router, Stack } from 'expo-router';
import { BellOff, Check, ExternalLink, Mail, MessageSquareText, Smartphone } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import {
  type Channel,
  type ChannelType,
  type Frequency,
  frequenciesFor,
  type PreferenceCategory,
  useChannels,
  useNotificationPreferences,
  useUpdatePreference,
} from '@/canvas/api/preferences';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  haptics,
  Icon,
  IconTile,
  ListGroup,
  ListItem,
  OptionGroup,
  Screen,
  Sheet,
  useToast,
} from '@/design';
import { useEventNotificationBrowser } from '@/features/content/eventNotificationBrowser';
import { ListSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { useOnline } from '@/features/offline/useOnline';

const channelInfo: Record<ChannelType, { labelKey: 'notifications.email' | 'notifications.sms' | 'notifications.push'; icon: typeof Mail }> = {
  email: { labelKey: 'notifications.email', icon: Mail },
  sms: { labelKey: 'notifications.sms', icon: MessageSquareText },
  push: { labelKey: 'notifications.push', icon: Smartphone },
};

const frequencyHelp: Record<Frequency, 'notifications.dailyHelp' | 'notifications.weeklyHelp' | undefined> = {
  immediately: undefined,
  daily: 'notifications.dailyHelp',
  weekly: 'notifications.weeklyHelp',
  never: undefined,
};

function ChannelPreferences({
  channel,
  showToast,
}: {
  channel: Channel;
  showToast: (message: string) => void;
}) {
  const { t } = useTranslation();
  const preferences = useNotificationPreferences(channel.id);
  const update = useUpdatePreference(channel.id);
  const online = useOnline();
  const [editing, setEditing] = useState<PreferenceCategory | null>(null);
  const options = frequenciesFor(channel.type);

  // Mutation callbacks retain the viewing translator, even if the account changes while saving.
  const choose = (category: PreferenceCategory, frequency: Frequency) => {
    setEditing(null);
    if (frequency === category.frequency) return;
    update.mutate(
      { category, frequency },
      {
        onSuccess: () => haptics.selection(),
        onError: (error) => {
          haptics.error();
          showToast(t('notifications.changeError', { category: preferenceText(category, t).title, error: error.message }));
        },
      },
    );
  };

  if (preferences.isPending) return <ListSkeleton rows={6} leading={false} />;
  if (preferences.isError)
    return (
      <LoadError
        title={t('notifications.preferencesError')}
        error={preferences.error}
        onRetry={() => preferences.refetch()}
      />
    );
  if (preferences.data.length === 0)
    return (
      <Card padding="none">
        <EmptyState
          icon={BellOff}
          title={t('notifications.preferencesEmpty')}
          description={t('notifications.preferencesEmptyHint')}
        />
      </Card>
    );

  return (
    <>
      {preferences.data.map((group) => (
        <ListGroup key={preferenceGroupId(group)} header={preferenceGroupTitle(group, t)}>
          {group.categories.map((category) => {
            // Text and push can't summarize; a stored summary reads as "right away" there.
            const shown = options.includes(category.frequency) ? category.frequency : 'immediately';
            return (
              <ListItem
                key={category.id}
                title={preferenceText(category, t).title}
                subtitle={preferenceText(category, t).description || undefined}
                value={frequencyLabel(shown, t)}
                disabled={!online}
                accessibilityLabel={t('notifications.categoryLabel', { category: preferenceText(category, t).title, frequency: frequencyLabel(shown, t), description: preferenceText(category, t).description })}
                onPress={() => setEditing(category)}
              />
            );
          })}
        </ListGroup>
      ))}
      <Sheet visible={!!editing} title={editing ? preferenceText(editing, t).title : ''} onClose={() => setEditing(null)}>
        {editing ? (
          <OptionGroup
            options={options.map((value) => ({
              value,
              label: frequencyLabel(value, t),
              subtitle: frequencyHelp[value] ? t(frequencyHelp[value]) : undefined,
            }))}
            selected={options.includes(editing.frequency) ? editing.frequency : 'immediately'}
            footer={preferenceText(editing, t).description || undefined}
            onSelect={(value) => choose(editing, value)}
          />
        ) : null}
      </Sheet>
    </>
  );
}

/**
 * Canvas notification preferences (SET-4): how often Canvas emails, texts,
 * or pushes each kind of update, per address. Easel's own alerts live in
 * Easel notifications, because Canvas only pushes to Instructure's apps (PRD 4.3).
 */
export default function CanvasNotificationsScreen() {
  const { t } = useTranslation();
  const channels = useChannels();
  const refresh = useRefreshControl([['preferences']]);
  const toast = useToast();
  const [chosen, setChosen] = useState<string | null>(null);
  const channel = channels.data?.find((c) => c.id === chosen) ?? channels.data?.[0];
  const browser = useEventNotificationBrowser([], !channels.isPending && !channels.isError && !channel);
  const openChannelSettings = () =>
    browser.openSettings(() =>
      !channels.isPending && !channels.isError &&
      !(channels.data?.find((c) => c.id === chosen) ?? channels.data?.[0]));

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('notifications.canvasTitle') }} />
      <Screen contentClassName="gap-6" refreshControl={refresh}>
        <Callout
          tone="info"
          title={t('notifications.canvasIntroTitle')}
          action={{ label: t('notifications.easelTitle'), onPress: () => router.push('/notification-settings') }}
        >
          {t('notifications.canvasIntro')}
        </Callout>

        {channels.isPending ? (
          <ListSkeleton rows={2} />
        ) : channels.isError ? (
          <LoadError
            title={t('notifications.channelsError')}
            error={channels.error}
            onRetry={() => channels.refetch()}
          />
        ) : !channel ? (
          <Card padding="none">
            <EmptyState
              icon={Mail}
              title={t('notifications.channelsEmpty')}
              description={t('notifications.channelsEmptyHint')}
              action={{
                label: t('notifications.openCanvasSettings'),
                leadingIcon: ExternalLink,
                onPress: openChannelSettings,
              }}
            />
          </Card>
        ) : (
          <>
            <ListGroup
              header={t('notifications.sendTo')}
              footer={
                channel.type === 'push'
                  ? t('notifications.pushHint')
                  : channel.confirmed
                    ? undefined
                    : t('notifications.unconfirmedHint')
              }
            >
              {channels.data.map((c) => {
                const info = channelInfo[c.type];
                const selected = c.id === channel.id;
                return (
                  <ListItem
                    key={c.id}
                    leading={<IconTile icon={info.icon} tone={selected ? 'accent' : 'neutral'} />}
                    title={t(info.labelKey)}
                    subtitle={c.confirmed ? c.address : t('notifications.notConfirmed', { address: c.address })}
                    subtitleLines={2}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    trailing={selected ? <Icon icon={Check} tone="accent" strokeWidth={2.25} /> : null}
                    chevron={false}
                    onPress={() => {
                      if (selected) return;
                      haptics.selection();
                      setChosen(c.id);
                    }}
                  />
                );
              })}
            </ListGroup>
            <ChannelPreferences key={channel.id} channel={channel} showToast={toast.show} />
          </>
        )}

        <View className="items-start px-1">
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={ExternalLink}
            onPress={() => browser.open('/profile/communication')}
          >
            {t('notifications.openCanvas')}
          </Button>
        </View>
      </Screen>
      {toast.element}
    </View>
  );
}
