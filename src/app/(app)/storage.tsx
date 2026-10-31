import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, RefreshControl, View } from 'react-native';

import { useDashboardCourses } from '@/canvas/api/courses';
import { useCanvas } from '@/canvas/session';
import {
  Button,
  Callout,
  haptics,
  ListGroup,
  ListItem,
  Screen,
  SegmentedControl,
  Skeleton,
  Switch,
  Text,
  useTheme,
} from '@/design';
import { listDownloads } from '@/features/files/download';
import { formatSize } from '@/features/files/kinds';
import { clearCache, imageCacheSize, savedDataSize } from '@/features/offline/cache';
import { QueuedChanges } from '@/features/offline/QueuedChanges';
import { setSchoolThemeEnabled, useSchoolThemeEnabled } from '@/features/offline/schoolTheme';
import { useOnline } from '@/features/offline/useOnline';
import { CourseSyncList, CourseSyncSheet, SyncProgressCard } from '@/features/sync/components';
import { startSync, useSyncRun } from '@/features/sync/runner';
import {
  setSyncSchedule,
  setSyncWifiOnly,
  type SyncSchedule,
  useSyncSettings,
  useSyncStatus,
} from '@/features/sync/settings';
import { useTranslation } from '@/i18n';
import {
  SettingsStorageWork,
  useSettingsStorageOwner,
} from '@/features/settings/settingsStorageLifetime';
import { setGradesWidgetEnabled, useWidgetSettings } from '@/features/widgets/settings';

type Usage = { savedData: number; images: number; files: number; fileCount: number };

async function measure(accountId: string): Promise<Usage> {
  const files = listDownloads(accountId);
  return {
    savedData: await savedDataSize(),
    images: imageCacheSize(),
    files: files.reduce((sum, f) => sum + f.size, 0),
    fileCount: files.length,
  };
}

/**
 * Offline and storage (SET-10, FILE-10, OFF-3): what Easel keeps on this
 * device, course sync, writes waiting to sync, and the device-wide display
 * choices that depend on stored data (Grades widget, school theme).
 */
export default function StorageScreen() {
  const { t, locale } = useTranslation();
  const { account, client } = useCanvas();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const online = useOnline();
  const courses = useDashboardCourses();
  const settings = useSyncSettings();
  const status = useSyncStatus();
  const run = useSyncRun();
  const widgets = useWidgetSettings();
  const schoolTheme = useSchoolThemeEnabled();
  const identity = useMemo(
    () => ({ account, client, queryClient }),
    [account, client, queryClient],
  );
  const owner = useSettingsStorageOwner(identity);
  const [work] = useState(() => new SettingsStorageWork());
  const [usageState, setUsage] = useState<{ owner: typeof owner; value: Usage } | null>(null);
  const usage = usageState?.owner === owner ? usageState.value : null;
  const [clearingOwner, setClearing] = useState<typeof owner | null>(null);
  const [refreshingOwner, setRefreshing] = useState<{ owner: typeof owner; key: object } | null>(
    null,
  );
  const [failure, setFailure] = useState<{
    owner: typeof owner;
    key: 'measureFailed' | 'clearFailed' | 'syncFailed' | 'settingsFailed' | 'coursesFailed';
  } | null>(null);
  const clearing = clearingOwner === owner;
  const refreshing = refreshingOwner?.owner === owner;
  const measurementIdentity = useMemo(() => ({ status }), [status]);
  const measurementOwner = useSettingsStorageOwner(measurementIdentity, owner);
  const remeasure = useCallback(() => {
    if (!measurementOwner.current()) return Promise.resolve();
    const current = measurementOwner.capture();
    return work.run(work.measurementKey(measurementOwner.key), async () => {
      try {
        await work.measure(
          () => measure(account.id),
          current,
          (value) => setUsage({ owner, value }),
        );
      } catch (error) {
        if (current()) setFailure({ owner, key: 'measureFailed' });
        throw error;
      }
    });
  }, [account.id, measurementOwner, owner, work]);
  const measureOnFocus = useCallback(() => {
    void remeasure().catch(() => {});
  }, [remeasure]);
  useFocusEffect(measureOnFocus);
  useEffect(measureOnFocus, [measureOnFocus]);

  const chosen = useMemo(() => settings.courses[account.id] ?? {}, [settings.courses, account.id]);
  const synced = status.courses[account.id] ?? {};
  const syncedBytes = Object.values(synced).reduce((sum, s) => sum + (s.bytes ?? 0), 0);
  // Changing what a course keeps must not dismiss its own controls. Only extra
  // non-dashboard membership changes which courses this list can present.
  const extraCourseIds = JSON.stringify(
    Object.keys(chosen)
      .filter((id) => !courses.data?.some((course) => course.id === id))
      .sort(),
  );
  const source = useMemo(
    () => ({ data: courses.data, extraCourseIds, pending: courses.isPending, error: courses.isError }),
    [courses.data, extraCourseIds, courses.isPending, courses.isError],
  );
  const courseOwner = useSettingsStorageOwner(source, owner);
  const [openCourse, setOpenCourse] = useState<{
    id: string;
    token: object;
    owner: typeof owner;
  } | null>(null);
  const preferences = useMemo(
    () => ({ settings, widgets, schoolTheme }),
    [settings, widgets, schoolTheme],
  );
  const preferenceOwner = useSettingsStorageOwner(preferences, owner);
  const syncEligibility = useMemo(() => ({ chosen, online, run }), [chosen, online, run]);
  const syncOwner = useSettingsStorageOwner(syncEligibility, owner);
  const schedules: { value: SyncSchedule; label: string }[] = [
    { value: 'off', label: t('settingsStorage.off') },
    { value: 'daily', label: t('settingsStorage.daily') },
    { value: 'weekly', label: t('settingsStorage.weekly') },
  ];
  // Dashboard courses first; then any course kept offline that has left the dashboard.
  const courseList = useMemo(() => {
    const list = (courses.data ?? []).map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      color: c.color,
    }));
    for (const id of Object.keys(chosen)) {
      if (!list.some((c) => c.id === id))
        list.push({
          id,
          code: t('settingsStorage.courseFallback', { id }),
          name: t('settingsStorage.notOnDashboard'),
          color: colors.fgSubtle,
        });
    }
    return list;
  }, [courses.data, chosen, colors.fgSubtle, t]);
  const sheetCourse =
    openCourse?.owner === courseOwner && courseOwner.ownsSheet(openCourse.token)
      ? (courseList.find((c) => c.id === openCourse.id) ?? null)
      : null;
  const chosenCount = Object.keys(chosen).length;

  const confirmClear = () => {
    const current = owner.capture();
    const confirmation = work.confirm(current);
    if (!confirmation) return;
    Alert.alert(
      t('settingsStorage.clearTitle'),
      t('settingsStorage.clearBody'),
      [
        { text: t('settingsStorage.cancel'), style: 'cancel', onPress: confirmation.cancel },
        {
          text: t('settingsStorage.clear'),
          style: 'destructive',
          onPress: () => {
            if (!confirmation.take()) return;
            setClearing(owner);
            setFailure(null);
            work.invalidateMeasurement();
            void work
              .run('clear', async () => {
                // Retire a confirmation even if its account changes before effect entry.
                if (!current()) return;
                await clearCache(queryClient);
                if (current()) haptics.success();
              })
              .catch(() => {
                if (current()) setFailure({ owner, key: 'clearFailed' });
              })
              .finally(() => {
                if (current()) {
                  setClearing(null);
                  // A pre-clear measurement may still be pending; use a fresh read.
                  void work
                    .measure(
                      () => measure(account.id),
                      current,
                      (value) => setUsage({ owner, value }),
                    )
                    .catch(() => {
                      if (current())
                        setFailure((previous) => previous ?? { owner, key: 'measureFailed' });
                    });
                }
              });
          },
        },
      ],
      { onDismiss: confirmation.cancel },
    );
  };

  const refreshKey = useMemo(() => ({ measurementOwner }), [measurementOwner]);
  const refresh = () => {
    if (!measurementOwner.current()) return Promise.resolve();
    const current = owner.capture();
    if (!work.busy(refreshKey)) {
      setRefreshing({ owner, key: refreshKey });
      setFailure(null);
    }
    return work.run(refreshKey, async () => {
      if (!current()) return;
      try {
        await remeasure();
      } catch {
        /* The measurement reports its own current localized failure. */
      } finally {
        if (current())
          setRefreshing((previous) => (previous?.key === refreshKey ? null : previous));
      }
    });
  };
  const syncAll = () => {
    if (!syncOwner.current() || !chosenCount || !online || run) return;
    const eligible = syncOwner.capture();
    const current = owner.capture();
    void work
      .run('sync', async () => {
        if (eligible()) await startSync({ account, client });
      })
      .catch(() => {
        if (current()) setFailure({ owner, key: 'syncFailed' });
      });
  };
  const changePreference = <T,>(key: string, value: T, setter: (value: T) => void) => {
    if (!preferenceOwner.claim(key)) return;
    try {
      setter(value);
    } catch {
      preferenceOwner.release(key);
      setFailure({ owner, key: 'settingsFailed' });
    }
  };

  const cacheBytes = usage ? usage.savedData + usage.images : 0;

  return (
    <>
      <Stack.Screen options={{ title: t('settingsStorage.title') }} />
      <Screen
        contentClassName="gap-6"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        <QueuedChanges />
        {failure?.owner === owner ? (
          <Callout tone="danger">{t(`settingsStorage.${failure.key}`)}</Callout>
        ) : null}

        <ListGroup header={t('settingsStorage.device')} footer={t('settingsStorage.deviceFooter')}>
          {usage ? (
            <>
              <ListItem
                title={t('settingsStorage.cache')}
                value={formatSize(cacheBytes, locale) ?? undefined}
                chevron={false}
              />
              <ListItem
                title={t('settingsStorage.downloads')}
                value={
                  usage.fileCount
                    ? t('settingsStorage.countSize', {
                        count: usage.fileCount,
                        size: formatSize(usage.files, locale) ?? '',
                      })
                    : t('settingsStorage.none')
                }
                accessibilityLabel={t('settingsStorage.downloadsLabel', {
                  count: usage.fileCount,
                  size: formatSize(usage.files, locale) ?? '',
                })}
                accessibilityHint={t('settingsStorage.downloadsHint')}
                onPress={() => {
                  if (owner.current()) router.push('/files/downloads');
                }}
              />
              <ListItem
                title={t('settingsStorage.synced')}
                value={
                  chosenCount
                    ? t('settingsStorage.countSize', {
                        count: chosenCount,
                        size: formatSize(syncedBytes, locale) ?? '',
                      })
                    : t('settingsStorage.none')
                }
                chevron={false}
              />
            </>
          ) : (
            <View className="gap-3 p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </View>
          )}
        </ListGroup>
        <Button variant="secondary" loading={clearing} onPress={confirmClear}>
          {t('settingsStorage.clear')}
        </Button>

        <View className="gap-3">
          <Text variant="title3" accessibilityRole="header" className="px-1">
            {t('settingsStorage.courseSync')}
          </Text>
          <Text variant="subhead" tone="muted" className="px-1">
            {t('settingsStorage.courseSyncBody')}
          </Text>
        </View>

        {run && run.accountId === account.id ? <SyncProgressCard run={run} /> : null}

        {courses.isPending ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : courses.isError && courseList.length === 0 ? (
          <Callout
            tone="danger"
            title={t('settingsStorage.coursesFailed')}
            action={{
              label: t('settingsStorage.retry'),
              onPress: () => {
                if (!courseOwner.current()) return;
                const current = courseOwner.capture();
                void work
                  .run(courseOwner, async () => {
                    if (current()) await courses.refetch();
                  })
                  .catch(() => {
                    if (current()) setFailure({ owner, key: 'coursesFailed' });
                  });
              },
            }}
          >
            {courses.error.message}
          </Callout>
        ) : courseList.length === 0 ? (
          <Callout tone="info">{t('settingsStorage.empty')}</Callout>
        ) : (
          <CourseSyncList
            courses={courseList}
            onOpen={(id) => {
              if (!courseOwner.current() || !courseList.some((c) => c.id === id)) return;
              const token = courseOwner.openSheet();
              if (token) setOpenCourse({ id, token, owner: courseOwner });
            }}
          />
        )}

        <View className="gap-2">
          <Button disabled={!chosenCount || !online || !!run} onPress={syncAll}>
            {t('settingsStorage.sync')}
          </Button>
          {!online ? (
            <Text variant="footnote" tone="muted" align="center">
              {t('settingsStorage.offline')}
            </Text>
          ) : null}
        </View>

        <ListGroup
          header={t('settingsStorage.automatic')}
          footer={
            settings.schedule === 'off'
              ? t('settingsStorage.scheduleOff')
              : t(
                  settings.schedule === 'daily'
                    ? 'settingsStorage.scheduleDaily'
                    : 'settingsStorage.scheduleWeekly',
                )
          }
        >
          <View className="px-4 py-3">
            <SegmentedControl
              options={schedules}
              value={settings.schedule}
              onChange={(value) => changePreference('schedule', value, setSyncSchedule)}
              accessibilityLabel={t('settingsStorage.frequency')}
            />
          </View>
          <ListItem
            title={t('settingsStorage.wifi')}
            subtitle={t('settingsStorage.wifiBody')}
            trailing={
              <Switch
                accessibilityLabel={t('settingsStorage.wifi')}
                value={settings.wifiOnly}
                onValueChange={(value) => changePreference('wifi', value, setSyncWifiOnly)}
              />
            }
            chevron={false}
          />
        </ListGroup>

        <ListGroup header={t('settingsStorage.widgets')} footer={t('settingsStorage.widgetsBody')}>
          <ListItem
            title={t('settingsStorage.gradesWidget')}
            trailing={
              <Switch
                accessibilityLabel={t('settingsStorage.gradesWidget')}
                value={widgets.gradesEnabled}
                onValueChange={(value) =>
                  changePreference('widgets', value, setGradesWidgetEnabled)
                }
              />
            }
            chevron={false}
          />
        </ListGroup>

        <ListGroup header={t('settingsStorage.theme')} footer={t('settingsStorage.themeBody')}>
          <ListItem
            title={t('settingsStorage.schoolTheme')}
            trailing={
              <Switch
                accessibilityLabel={t('settingsStorage.schoolTheme')}
                value={schoolTheme}
                onValueChange={(value) => changePreference('theme', value, setSchoolThemeEnabled)}
              />
            }
            chevron={false}
          />
        </ListGroup>
      </Screen>

      <CourseSyncSheet
        course={sheetCourse}
        onClose={() => {
          if (openCourse?.owner === courseOwner && courseOwner.closeSheet(openCourse.token))
            setOpenCourse(null);
        }}
      />
    </>
  );
}
