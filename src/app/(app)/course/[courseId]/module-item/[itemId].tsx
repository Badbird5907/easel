import { courseContext } from '@/canvas/api/discussions';
import { TopicView } from '@/features/discussions/TopicView';
import { useTranslation } from '@/i18n';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import {
  type ModuleItem,
  useMarkModuleItemDone,
  useMarkModuleItemViewed,
  useModuleItemSequence,
  useModules,
} from '@/canvas/api/modules';
import { useAccountKey } from '@/canvas/query';
import { Screen } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import {
  MasteryPathCard,
  ModuleItemContent,
  RequirementCard,
  SequenceBar,
} from '@/features/course/ModuleItemParts';
import { DetailSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { FileViewer } from '@/features/files/FileViewer';
import { useOnline } from '@/features/offline/useOnline';

/** One module item, rendered by type, with previous and next across modules (CONTENT-7). */
export default function ModuleItemScreen() {
  const { t } = useTranslation();
  const accountKey = useAccountKey();
  const online = useOnline();
  const { courseId, itemId } = useLocalSearchParams<{ courseId: string; itemId: string }>();
  const sequence = useModuleItemSequence(courseId, itemId);
  const modules = useModules(courseId);
  const markViewed = useMarkModuleItemViewed(courseId);
  const markDone = useMarkModuleItemDone(courseId);
  const [viewRetry, setViewRetry] = useState(0);
  const refreshControl = useRefreshControl([['courses', courseId]], () => setViewRetry((n) => n + 1));

  // The modules list carries completion and lock state; the sequence doesn't.
  const fromModules = modules.data?.flatMap((m) => m.items).find((i) => i.id === itemId);
  const sourceItem = fromModules ?? sequence.data?.current ?? null;
  const parentModule = modules.data?.find((m) => m.id === sourceItem?.moduleId) ?? sequence.data?.module;
  const item: ModuleItem | null =
    sourceItem && parentModule?.state === 'locked' ? { ...sourceItem, locked: true } : sourceItem;
  const moduleName =
    modules.data?.find((m) => m.id === item?.moduleId)?.name ??
    sequence.data?.module?.name ??
    t('modules.module');

  // Deduplicate pending/successful views; failures can retry on reconnect, refresh or revisit.
  const viewed = useRef(new Set<string>());
  const { mutateAsync: markRead } = markViewed;
  const viewedItemId = item?.id;
  const viewedModuleId = item?.moduleId;
  const viewedType = item?.type;
  const viewedRequirement = item?.requirement?.type;
  const viewedLocked = item?.locked;
  useEffect(() => {
    if (
      !online ||
      !viewedItemId ||
      !viewedModuleId ||
      viewedType === 'SubHeader' ||
      viewedRequirement !== 'must_view' ||
      viewedLocked
    )
      return;
    const key = JSON.stringify([accountKey, courseId, viewedModuleId, viewedItemId]);
    if (viewed.current.has(key)) return;
    const attempts = viewed.current;
    attempts.add(key);
    // Per-call promises settle even when another item replaces the mutation observer's callbacks.
    void markRead({ moduleId: viewedModuleId, itemId: viewedItemId }).catch(() => attempts.delete(key));
  }, [
    accountKey,
    courseId,
    viewedItemId,
    viewedModuleId,
    viewedType,
    viewedRequirement,
    viewedLocked,
    online,
    viewRetry,
    markRead,
  ]);

  const isDiscussion = item?.type === 'Discussion' && !!item.contentId && !item.locked;
  const isFile = item?.type === 'File' && !!item.contentId && !item.locked;

  const go = (target: ModuleItem) => router.setParams({ itemId: target.id });

  const setDone = (done: boolean) => {
    if (!item) return;
    markDone.mutate(
      { moduleId: item.moduleId, itemId: item.id, done },
      {
        onError: (error) =>
          Alert.alert(done ? t('modules.markError') : t('modules.undoError'), error.message),
      },
    );
  };

  let body;
  if (!item) {
    body =
      sequence.isError && !modules.isPending ? (
        <LoadError
          title={t('modules.itemLoadError')}
          error={sequence.error}
          onRetry={() => sequence.refetch()}
        />
      ) : sequence.isSuccess && !modules.isPending ? (
        <LoadError
          title={t('modules.itemMissing')}
          error={new Error(t('modules.itemMissingDescription'))}
          onRetry={() => modules.refetch()}
        />
      ) : (
        <DetailSkeleton />
      );
  } else {
    body = (
      <>
        <ModuleItemContent item={item} courseId={courseId} />
        <RequirementCard item={item} onSetDone={setDone} busy={markDone.isPending} />
        {item.type === 'Assignment' || item.type === 'Quiz' ? (
          <MasteryPathCard item={item} courseId={courseId} />
        ) : null}
      </>
    );
  }

  return (
    <CourseScope courseId={courseId} title={moduleName}>
      <View className="flex-1">
        {isDiscussion && item?.contentId ? (
          <>
            <TopicView key={itemId} context={courseContext(courseId)} topicId={item.contentId} />
            {item.requirement ? (
              <View className="px-4 py-2">
                <RequirementCard item={item} onSetDone={setDone} busy={markDone.isPending} />
              </View>
            ) : null}
          </>
        ) : isFile && item?.contentId ? (
          <>
            <FileViewer
              key={itemId}
              fileId={item.contentId}
              courseId={courseId}
              canvasUrl={item.htmlUrl ?? undefined}
            />
            {item.requirement ? (
              <View className="px-4 py-2">
                <RequirementCard item={item} onSetDone={setDone} busy={markDone.isPending} />
              </View>
            ) : null}
          </>
        ) : (
          <Screen key={itemId} refreshControl={refreshControl} contentClassName="gap-6">
            {body}
          </Screen>
        )}
        <SequenceBar prev={sequence.data?.prev ?? null} next={sequence.data?.next ?? null} onGo={go} />
      </View>
    </CourseScope>
  );
}
