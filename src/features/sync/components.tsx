import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import type { Course } from '@/canvas/models';
import { useCanvas } from '@/canvas/session';
import {
  AccentScope,
  Button,
  Card,
  ListGroup,
  ListItem,
  type Option,
  OptionGroup,
  ProgressBar,
  Sheet,
  Switch,
  Text,
} from '@/design';
import { formatSize } from '@/features/files/kinds';
import { useOnline } from '@/features/offline/useOnline';
import { formatNumber, useTranslation, type Translate } from '@/i18n';
import { createDateContext, relativeAgeLabel, useDisplayTimeZone, type DateContext } from '@/lib/dates';

import { SyncControlsEntry, useSyncControlsLifetime } from './syncControlsLifetime';

import { cancelSyncRun, removeCourseSync, startSync, type SyncRun, useSyncRun } from './runner';
import {
  type CourseSyncStatus,
  defaultContent,
  setCourseContent,
  type SyncContent,
  syncContentTypes,
  syncSettingsStore,
  useSyncSettings,
  useSyncStatus,
} from './settings';

/** Compose standalone elapsed wording; translated compact ages are never parsed. */
export function syncedLabel(at: number, now = new Date(), context?: DateContext): string {
  if (context) {
    const minutes = Math.floor((now.getTime() - at) / 60_000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const age =
      minutes < 1
        ? context.t('date.now')
        : days >= 7
          ? context.formatShortDate(new Date(at), now)
          : new Intl.RelativeTimeFormat(context.locale, { numeric: 'always' }).format(
              -(minutes < 60 ? minutes : hours < 24 ? hours : days),
              minutes < 60 ? 'minute' : hours < 24 ? 'hour' : 'day',
            );
    return context.t('syncControls.synced', { age });
  }
  return `Synced ${relativeAgeLabel(new Date(at), now)}`;
}

/** What a running sync is doing, in words: "Syncing BIO 201: Files, 12 of 40". */
export function describeRun(
  run: SyncRun,
  context?: DateContext,
): { title: string; detail: string; fraction: number } {
  if (context) {
    const { t, locale } = context;
    const course = run.courses[run.index];
    const progress = run.progress;
    const title = course
      ? t('syncControls.syncCourse', { course: course.name })
      : t('syncControls.syncCourses');
    return {
      title:
        run.courses.length > 1
          ? t('syncControls.sequence', { title, current: run.index + 1, total: run.courses.length })
          : title,
      detail: progress
        ? [
            t('syncControls.progress', {
              stage: progress.stepKey ? t(`syncControls.stage.${progress.stepKey}`) : progress.step,
              done: progress.done,
              total: progress.total,
            }),
            progress.bytes > 0 ? formatSize(progress.bytes, locale) : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : t('syncControls.preparing'),
      fraction: progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0,
    };
  }
  const course = run.courses[run.index];
  const progress = run.progress;
  const many = run.courses.length > 1 ? ` (${run.index + 1} of ${run.courses.length})` : '';
  const fraction = progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
  const bytes = progress && progress.bytes > 0 ? ` · ${formatSize(progress.bytes)}` : '';
  return {
    title: `Syncing ${course?.name ?? 'courses'}${many}`,
    detail: progress ? `${progress.step}, ${progress.done} of ${progress.total}${bytes}` : 'Getting ready',
    fraction,
  };
}

/** The sync running now, with its progress and a way to stop it. */
export function SyncProgressCard({ run }: { run: SyncRun }) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const { account, client } = useCanvas();
  const observed = useSyncRun();
  const current = useSyncControlsLifetime([
    account.id,
    client,
    run.accountId,
    run.startedAt,
    run.courses,
    observed?.accountId,
    observed?.startedAt,
    observed?.courses,
  ]);
  const stopEntry = useMemo(
    () => new SyncControlsEntry([run.accountId, run.startedAt, run.courses]),
    [run.accountId, run.startedAt, run.courses],
  );
  const { title, detail, fraction } = describeRun(run, createDateContext(locale, zone));
  const percent = formatNumber(
    Math.round(fraction * 100) / 100,
    { style: 'percent', maximumFractionDigits: 0 },
    locale,
  );
  return (
    <Card className="gap-3">
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={t('syncControls.runLabel', { title, detail, percent })}
      >
        <Text variant="headline" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="footnote" tone="muted" tabular numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <ProgressBar value={fraction} accessibilityLabel={t('syncControls.progressLabel', { percent })} />
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onPress={() => {
          if (
            stopEntry.used ||
            !current() ||
            account.id !== run.accountId ||
            !observed ||
            observed.accountId !== run.accountId ||
            observed.startedAt !== run.startedAt ||
            observed.courses !== run.courses
          )
            return;
          stopEntry.use();
          // The runner compares ownership atomically, even before a new UI commit.
          cancelSyncRun(run);
        }}
      >
        {t('syncControls.stop')}
      </Button>
    </Card>
  );
}

function contentSummary(content: SyncContent[], t: Translate): string {
  const labels = syncContentTypes
    .filter((t) => content.includes(t.value))
    .map((item) => t(`syncControls.stage.${item.value}`));
  if (labels.length === syncContentTypes.length) return t('syncControls.everything');
  if (labels.length <= 3) return labels.join(', ');
  return t('syncControls.more', { items: labels.slice(0, 2).join(', '), count: labels.length - 2 });
}

function statusLine(
  content: SyncContent[] | undefined,
  status: CourseSyncStatus | undefined,
  running: boolean,
  context: DateContext,
) {
  const { t, locale } = context;
  if (!content) return t('syncControls.notKept');
  const parts = [contentSummary(content, t)];
  if (running) parts.push(t('syncControls.syncing'));
  else if (status?.error) parts.push(status.error);
  else if (status?.syncedAt) parts.push(syncedLabel(status.syncedAt, new Date(), context));
  else parts.push(t('syncControls.notSynced'));
  if (status?.skipped) parts.push(t('syncControls.skipped', { count: status.skipped }));
  if (status?.unsupportedEmbeds) parts.push(t('syncControls.embeds'));
  if (status?.bytes) parts.push(formatSize(status.bytes, locale) ?? '');
  return parts.filter(Boolean).join(' · ');
}

type SyncCourse = Pick<Course, 'id' | 'code' | 'name' | 'color'>;

function CourseRow({ course, onOpen }: { course: SyncCourse; onOpen: () => void }) {
  const { account, client } = useCanvas();
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const current = useSyncControlsLifetime([account.id, client, course.id, course.code, course.name]);
  const settings = useSyncSettings();
  const status = useSyncStatus();
  const run = useSyncRun();
  const content = settings.courses[account.id]?.[course.id];
  const courseStatus = status.courses[account.id]?.[course.id];
  const running = run?.accountId === account.id && run.courses[run.index]?.id === course.id;
  const line = statusLine(content, courseStatus, running, createDateContext(locale, zone));

  return (
    <ListItem
      title={course.code}
      subtitle={line}
      subtitleLines={2}
      leading={
        <AccentScope color={course.color}>
          <View className="h-3 w-3 rounded-full bg-accent" />
        </AccentScope>
      }
      onPress={() => {
        if (current()) onOpen();
      }}
      accessibilityLabel={t('syncControls.rowLabel', { code: course.code, name: course.name, status: line })}
      accessibilityHint={t('syncControls.rowHint')}
    />
  );
}

/** Every course the student can keep offline, with what's kept and when it last synced. */
export function CourseSyncList({
  courses,
  onOpen,
}: {
  courses: SyncCourse[];
  onOpen: (courseId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ListGroup header={t('syncControls.courses')} footer={t('syncControls.coursesHelp')}>
      {courses.map((course) => (
        <CourseRow key={course.id} course={course} onOpen={() => onOpen(course.id)} />
      ))}
    </ListGroup>
  );
}

/** What to keep for one course, plus Sync now and Remove. */
export function CourseSyncSheet({
  course,
  onClose,
}: {
  course: Pick<Course, 'id' | 'code' | 'name' | 'color'> | null;
  onClose: () => void;
}) {
  const { account, client } = useCanvas();
  const settings = useSyncSettings();
  const status = useSyncStatus();
  const run = useSyncRun();
  const online = useOnline();
  const content = course ? (settings.courses[account.id]?.[course.id] ?? []) : [];
  const selected = new Set(content);
  const courseStatus = course ? status.courses[account.id]?.[course.id] : undefined;

  const { t, locale } = useTranslation();
  // Fallback course labels relabel with locale; the account/course IDs own work.
  const identity = JSON.stringify([
    account.id,
    account.user.id,
    account.baseUrl,
    account.host,
    course?.id,
  ]);
  const alive = useSyncControlsLifetime([identity, client]);
  const settingsValues = JSON.stringify(settings);
  const controlsCurrent = useSyncControlsLifetime([
    identity,
    client,
    settings,
    settingsValues,
    online,
    run,
    courseStatus,
  ]);
  const current = () =>
    controlsCurrent() && syncSettingsStore.get() === settings && JSON.stringify(settings) === settingsValues;
  const ledger = useMemo(() => new SyncControlsEntry([identity, client]), [identity, client]);
  const confirmation = useMemo(
    () => new SyncControlsEntry([identity, client, settings, online, run, courseStatus]),
    [identity, client, settings, online, run, courseStatus],
  );
  const latest = useRef({ t, onClose, course });
  useLayoutEffect(() => {
    latest.current = { t, onClose, course };
  }, [t, onClose, course]);
  const [error, setError] = useState<{
    identity: string;
    client: typeof client;
    kind: 'removeError' | 'startError';
  } | null>(null);
  const report = (kind: 'removeError' | 'startError') => {
    if (alive() && !ledger.closed) setError({ identity, client, kind });
  };
  const close = () => {
    if (!alive() || ledger.closed) return;
    ledger.close();
    latest.current.onClose();
  };
  const stopKeeping = (target: SyncCourse, synced: boolean) => {
    if (!current() || ledger.closed || ledger.busy || confirmation.pending) return;
    confirmation.setPending(true);
    const accountId = account.id;
    const courseId = target.id;
    let consumed = false;
    const dismiss = () => {
      consumed = true;
      confirmation.setPending(false);
    };
    const stop = () => {
      if (consumed) return;
      dismiss();
      if (!current() || ledger.closed || ledger.busy || account.id !== accountId || target.id !== courseId)
        return;
      ledger.setBusy(true);
      setError(null);
      void (async () => {
        try {
          // Once admitted, both original-account obligations must run in this order.
          setCourseContent(accountId, courseId, []);
          await removeCourseSync(accountId, courseId);
        } catch {
          report('removeError');
        } finally {
          ledger.setBusy(false);
        }
      })();
    };
    if (!synced) {
      stop();
      return;
    }
    Alert.alert(
      t('syncControls.removeTitle', { course: target.code }),
      t('syncControls.removeBody'),
      [
        { text: t('syncControls.cancel'), style: 'cancel', onPress: dismiss },
        { text: t('syncControls.remove'), style: 'destructive', onPress: stop },
      ],
      { onDismiss: dismiss },
    );
  };
  const editEntry = new SyncControlsEntry([]);
  const mayEdit = () => {
    if (!current() || ledger.closed || ledger.busy || confirmation.pending || editEntry.used) return false;
    return true;
  };

  const tLabel = (value: SyncContent) => t(`syncControls.stage.${value}`);
  const tDetail = (value: SyncContent) =>
    t(`syncControls.detail.${value}`, { size: formatSize(8_000_000, locale) ?? '' });
  const options: Option<SyncContent>[] = syncContentTypes.map((t) => ({
    value: t.value,
    label: tLabel(t.value),
    subtitle: tDetail(t.value),
  }));

  const kept = content.length > 0;

  const toggle = (value: SyncContent) => {
    if (!course || !mayEdit()) return;
    const next = selected.has(value) ? content.filter((c) => c !== value) : [...content, value];
    if (next.length === 0) {
      stopKeeping(course, !!courseStatus?.syncedAt);
      return;
    }
    editEntry.use();
    setCourseContent(account.id, course.id, next);
  };

  const keep = (on: boolean) => {
    if (!course || !mayEdit()) return;
    if (on) {
      editEntry.use();
      setCourseContent(account.id, course.id, defaultContent);
    } else stopKeeping(course, !!courseStatus?.syncedAt);
  };

  const sizeNote = courseStatus?.bytes
    ? t('syncControls.size', { size: formatSize(courseStatus.bytes, locale) ?? '' })
    : t('syncControls.empty');

  return (
    <Sheet
      visible={!!course}
      title={course ? t('syncControls.offlineCourse', { course: course.code }) : t('syncControls.offline')}
      onClose={() => {
        if (current()) close();
      }}
    >
      {course ? (
        <View className="gap-4">
          <ListGroup footer={kept ? sizeNote : t('syncControls.keepHelp')}>
            <ListItem
              title={t('syncControls.keep')}
              trailing={
                <Switch
                  accessibilityLabel={t('syncControls.keepLabel', { course: course.code })}
                  value={kept}
                  onValueChange={keep}
                />
              }
              chevron={false}
            />
          </ListGroup>
          {kept ? (
            <OptionGroup
              options={options}
              selected={selected}
              onSelect={toggle}
              header={t('syncControls.what')}
              footer={t('syncControls.mediaHelp')}
            />
          ) : null}
          <View className="gap-2">
            {error?.identity === identity && error.client === client ? (
              <Text variant="footnote" tone="danger" accessibilityRole="alert">
                {t(`syncControls.${error.kind}`)}
              </Text>
            ) : null}
            <Button
              disabled={!content.length || !online || !!run}
              onPress={() => {
                if (
                  !current() ||
                  ledger.closed ||
                  ledger.busy ||
                  confirmation.pending ||
                  !content.length ||
                  !online ||
                  run
                )
                  return;
                ledger.setBusy(true);
                setError(null);
                void (async () => {
                  try {
                    await startSync({
                      account,
                      client,
                      courseIds: [course.id],
                      names: new Map([[course.id, latest.current.course?.code ?? course.code]]),
                    });
                    if (current()) close();
                  } catch {
                    report('startError');
                  } finally {
                    ledger.setBusy(false);
                  }
                })();
              }}
            >
              {t('syncControls.now')}
            </Button>
            {!online ? (
              <Text variant="footnote" tone="muted" align="center">
                {t('syncControls.offlineHelp')}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}
