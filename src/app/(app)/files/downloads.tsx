import { Stack, useFocusEffect } from 'expo-router';
import { HardDriveDownload, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, RefreshControl } from 'react-native';

import { useCanvas } from '@/canvas/session';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  IconButton,
  ListGroup,
  ListItem,
  Screen,
  Skeleton,
  Text,
  useTheme,
} from '@/design';
import { listDownloads, removeDownload } from '@/features/files/download';
import { FileThumbnail } from '@/features/files/FileThumbnail';
import { describeFile, formatSize } from '@/features/files/kinds';
import { openFile } from '@/features/files/open';
import { useFileLifetime } from '@/features/files/useFileLifetime';
import { useTranslation } from '@/i18n';

/** Files kept on this device, which open without a connection (FILE-10). */
export default function DownloadsScreen() {
  const { account, client } = useCanvas();
  const { t, locale } = useTranslation();
  const { colors } = useTheme();
  const lifetime = useFileLifetime(account.id, client);
  const [result, setResult] = useState<{
    lifetime: typeof lifetime;
    items: ReturnType<typeof listDownloads>;
    failed: boolean;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Hide the previous context's data on the very first render, before effects run.
  const current = result?.lifetime === lifetime ? result : null;
  const items = current?.items ?? [];

  const reload = useCallback(() => {
    if (!lifetime.isCurrent()) return;
    try {
      const next = listDownloads(account.id);
      if (lifetime.isCurrent()) setResult({ lifetime, items: next, failed: false });
    } catch {
      if (lifetime.isCurrent()) setResult({ lifetime, items: [], failed: true });
    } finally {
      if (lifetime.isCurrent()) setRefreshing(false);
    }
  }, [account.id, lifetime]);
  // Opening a file downloads it; show it here when coming back. Locale is not a dependency.
  useFocusEffect(reload);

  const total = items.reduce((sum, item) => sum + item.size, 0);

  const removeAll = () => {
    if (!lifetime.isCurrent()) return;
    Alert.alert(t('files.downloads.confirmTitle'), t('files.downloads.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('files.downloads.confirmRemove'),
        style: 'destructive',
        onPress: () => {
          if (!lifetime.isCurrent()) return;
          items.forEach((item) => removeDownload(account.id, item.file.id));
          reload();
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: t('files.downloaded') }} />
      <Screen
        contentClassName="gap-4"
        refreshControl={
          <RefreshControl
            refreshing={!!current && refreshing}
            onRefresh={() => {
              if (!lifetime.isCurrent()) return;
              setRefreshing(true);
              reload();
            }}
            tintColor={colors.fgMuted}
          />
        }
      >
        {!current ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : current.failed ? (
          <Callout
            tone="danger"
            title={t('files.downloads.loadError')}
            action={{ label: t('common.retry'), onPress: reload }}
          >
            {t('files.downloads.loadErrorDetail')}
          </Callout>
        ) : items.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={HardDriveDownload}
              title={t('files.downloads.empty')}
              description={t('files.downloads.emptyDetail')}
            />
          </Card>
        ) : (
          <>
            <Text variant="footnote" tone="muted" className="px-1">
              {t('files.downloads.summary', {
                count: items.length,
                size: formatSize(total, locale) ?? '',
              })}
            </Text>
            <ListGroup>
              {items.map(({ file, size, kept }) => {
                // Kept by a course sync (OFF-3); the next sync brings it back if removed.
                const summary = [
                  describeFile(file, locale).label,
                  formatSize(size, locale),
                  kept ? t('files.downloads.synced') : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <ListItem
                    key={file.id}
                    leading={<FileThumbnail file={{ ...file, thumbnailUrl: null }} />}
                    title={file.name}
                    subtitle={summary}
                    subtitleLines={1}
                    accessibilityLabel={t('file.rowLabel', { name: file.name, summary })}
                    chevron={false}
                    onPress={() => {
                      if (lifetime.isCurrent()) openFile(file.id);
                    }}
                    trailing={
                      <IconButton
                        icon={X}
                        size="sm"
                        variant="secondary"
                        accessibilityLabel={t('files.downloads.remove', { name: file.name })}
                        onPress={() => {
                          if (!lifetime.isCurrent()) return;
                          removeDownload(account.id, file.id);
                          reload();
                        }}
                      />
                    }
                  />
                );
              })}
            </ListGroup>
            <Button variant="ghost" className="self-center" onPress={removeAll}>
              {t('files.downloads.removeAll')}
            </Button>
          </>
        )}
      </Screen>
    </>
  );
}
