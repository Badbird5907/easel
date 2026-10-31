import { Clock } from 'lucide-react-native';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Platform, View } from 'react-native';

import { submissionFilesPath } from '@/canvas/api/submissions';
import { useCanvas } from '@/canvas/session';
import { Button, EmptyState, haptics, Text, useTheme } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import {
  claimToolLaunch,
  revokeToolLaunch,
  toolLaunchCurrent,
  subscribeToolLaunches,
  toolLaunchRevision,
  type PickedContent,
  type PickerOutcome,
} from '@/features/submissions/toolContent';
import { ToolPicker } from '@/features/submissions/ToolPicker';
import { addUploads, submissionSlot } from '@/features/submissions/uploadStore';
import { useTranslation } from '@/i18n';

type ToolFile = Extract<PickedContent, { kind: 'file' }>;
/** Dedicated directories prevent filename collisions and bound cleanup to this batch. */
async function download(content: ToolFile, dir: Directory) {
  dir.create({ intermediates: true });
  const file = await File.downloadFileAsync(content.url, dir, { idempotent: true });
  const name = /\.[a-z0-9]{2,5}$/i.test(content.name) ? content.name : file.name;
  return {
    uri: file.uri,
    name,
    size: file.size ?? null,
    mimeType: content.mimeType ?? file.type ?? null,
  };
}

export default function ToolPickerScreen() {
  const { courseId, assignmentId, toolId, toolName, launch } = useLocalSearchParams<{
    courseId: string;
    assignmentId: string;
    toolId: string;
    toolName?: string;
    launch?: string;
  }>();
  const { account, client } = useCanvas();
  const { t } = useTranslation();
  useSyncExternalStore(subscribeToolLaunches, toolLaunchRevision, toolLaunchRevision);
  const headerHeight = useHeaderHeight();
  const { colors } = useTheme();
  const name = toolName ?? t('toolPicker.tool');
  const accountId = account.id;
  const target = useMemo(
    () => ({ accountId, client, courseId, assignmentId, toolId, toolName }),
    [accountId, client, courseId, assignmentId, toolId, toolName],
  );
  const context = useMemo(() => ({ target, launch }), [target, launch]);
  const live = useRef<typeof context | null>(null);
  const [fetching, setFetching] = useState<{ context: object; files: ToolFile[] } | null>(null);
  const [expired, setExpired] = useState<object | null>(null);
  useLayoutEffect(() => {
    live.current = context;
    return () => {
      if (live.current === context) live.current = null;
      // Effect replay in Strict Mode reattaches this same committed context.
      // Old callbacks are inert immediately; disposal only waits one microtask.
      void Promise.resolve().then(() => {
        if (live.current !== context) revokeToolLaunch(launch, target);
      });
    };
  }, [context, launch, target]);
  const mounted = () => live.current === context;
  const current = () => {
    if (!mounted()) return false;
    if (toolLaunchCurrent(launch, target)) return true;
    setExpired(context);
    return false;
  };
  const back = () => {
    if (!mounted()) return;
    if (router.canGoBack()) router.back();
    else
      router.replace({
        pathname: '/course/[courseId]/assignment/[assignmentId]',
        params: { courseId, assignmentId },
      });
  };
  const onOutcome = async (outcome: PickerOutcome): Promise<boolean> => {
    if (!current()) return false;
    const claim = claimToolLaunch(launch, target);
    if (!claim) return false;
    const owns = () => mounted() && claim.current();
    const translate = t; // Native feedback snapshots the invocation language.
    if (outcome.type === 'cancelled') {
      if (owns()) {
        if (claim.complete()) back();
      }
      return true;
    }
    if (outcome.type === 'error') {
      if (owns()) {
        haptics.error();
        if (owns())
          Alert.alert(
            translate('toolPicker.noContent', { name }),
            translate('toolPicker.toolError', { name, message: outcome.message }),
            [{ text: translate('common.done') }],
          );
      }
      claim.release();
      return false;
    }
    const files = outcome.items.filter((item): item is ToolFile => item.kind === 'file');
    const directories: Directory[] = [];
    let uploadOwned = false;
    try {
      if (!outcome.items.length) return false;
      if (files.length) {
        setFetching({ context, files });
        if (!owns()) return false;
        // All settlements must be known before deleting any partial download directory.
        const results = await Promise.allSettled(
          files.map(async (file) => {
            const dir = new Directory(Paths.cache, 'tool-picks', randomUUID());
            directories.push(dir);
            return download(file, dir);
          }),
        );
        if (!owns()) return false;
        if (results.some((result) => result.status === 'rejected')) throw new Error('download');
        const local = results.map((result) => {
          if (result.status !== 'fulfilled') throw new Error('download');
          return result.value;
        });
        if (
          !claim.accept({ ...files[0], toolName: toolName ?? name }, () => {
            // Accepted before addUploads emits synchronously. Ownership transfers at entry:
            // async copies may still read these cache files after addUploads returns.
            uploadOwned = true;
            addUploads(
              submissionSlot(accountId, courseId, assignmentId),
              { client, preflightPath: submissionFilesPath(courseId, assignmentId) },
              local,
            );
          })
        ) {
          if (mounted()) setExpired(context);
          return false;
        }
      } else if (!claim.accept({ ...outcome.items[0], toolName: toolName ?? name })) {
        if (mounted()) setExpired(context);
        return false;
      }
      if (owns()) haptics.success();
      if (owns() && files.length)
        AccessibilityInfo.announceForAccessibility(translate('toolPicker.added', { name }));
      if (owns()) {
        if (claim.complete()) back();
      }
      return true;
    } catch {
      if (owns()) {
        haptics.error();
        if (owns())
          Alert.alert(
            translate('toolPicker.downloadFailed', { name }),
            translate('toolPicker.downloadHelp'),
            [{ text: translate('common.done') }],
          );
      }
      return false;
    } finally {
      if (!uploadOwned)
        for (const dir of directories) {
          try {
            dir.delete();
          } catch {
            /* Best-effort, only our private cache directory. */
          }
        }
      if (mounted()) {
        setFetching(null);
        if (!claim.current()) setExpired(context);
      }
      claim.release();
    }
  };
  const valid = expired !== context && toolLaunchCurrent(launch, target);
  const files = fetching?.context === context ? fetching.files : null;
  return (
    <CourseScope courseId={courseId} title={name}>
      <View className="flex-1 bg-bg">
        {valid ? (
          <ToolPicker
            courseId={courseId}
            assignmentId={assignmentId}
            toolId={toolId}
            toolName={name}
            onOutcome={onOutcome}
            isCurrent={current}
            launchIdentity={context}
            topInset={Platform.OS === 'ios' ? headerHeight : 0}
          />
        ) : (
          <View className="flex-1 justify-center" style={{ paddingTop: headerHeight }}>
            <EmptyState
              icon={Clock}
              title={t('toolPicker.expired')}
              description={t('toolPicker.expiredHelp')}
            />
            <Button variant="ghost" onPress={back}>
              {t('toolPicker.back')}
            </Button>
          </View>
        )}
        {valid && files ? (
          <View
            className="absolute inset-0 items-center justify-center gap-3 bg-bg px-8"
            accessibilityViewIsModal
            accessibilityLiveRegion="polite"
          >
            <ActivityIndicator color={colors.fgMuted} />
            <Text variant="body" align="center">
              {t('toolPicker.getting', {
                file:
                  files.length === 1
                    ? files[0].name
                    : t('toolPicker.files', { count: files.length }),
                name,
              })}
            </Text>
          </View>
        ) : null}
      </View>
    </CourseScope>
  );
}
