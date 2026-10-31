import { useTranslation, formatNumber } from '@/i18n';
import { useLocalSearchParams } from 'expo-router';
import { Layers } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import {
  type ModuleItem,
  useMarkModuleItemDone,
  useMasteryPaths,
  useModules,
} from '@/canvas/api/modules';
import { Card, EmptyState, ProgressBar, Screen, Text } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { ModuleSection } from '@/features/course/ModuleList';
import { ListSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { TabDisabled, useTabGate } from '@/features/course/TabGate';

/** Modules with progress, requirements, prerequisites, locks (CONTENT-6), and mastery paths (ASSIGN-15). */
export default function ModulesScreen() {
  const { t, locale } = useTranslation();
  const { courseId, fromHome } = useLocalSearchParams<{ courseId: string; fromHome?: string }>();
  const gate = useTabGate(courseId, 'modules', fromHome === '1');
  const modules = useModules(courseId);
  const masteryPaths = useMasteryPaths(courseId, modules.data);
  const markDone = useMarkModuleItemDone(courseId);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const refreshControl = useRefreshControl([
    ['courses', courseId, 'modules'],
    ['courses', courseId, 'tabs'],
  ]);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onMarkDone = (item: ModuleItem) =>
    markDone.mutate(
      { moduleId: item.moduleId, itemId: item.id, done: true },
      { onError: (error) => Alert.alert(t('modules.markError'), error.message) },
    );

  const list = modules.data ?? [];
  const tracked = list.filter((m) => m.items.some((item) => item.requirement));
  const completed = tracked.filter((m) => m.state === 'completed').length;

  return (
    <CourseScope courseId={courseId} title={t('modules.title')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-7">
        {gate === 'hidden' ? (
          <TabDisabled courseId={courseId} label={t('modules.title')} />
        ) : modules.isPending ? (
          <ListSkeleton rows={6} />
        ) : modules.isError ? (
          <LoadError
            title={t('modules.loadError')}
            error={modules.error}
            onRetry={() => modules.refetch()}
          />
        ) : list.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={Layers}
              title={t('modules.empty')}
              description={t('modules.emptyDescription')}
            />
          </Card>
        ) : (
          <>
            {tracked.length > 0 && completed < tracked.length ? (
              <Card className="gap-3">
                <View className="flex-row items-baseline justify-between gap-3">
                  <Text variant="headline" tabular>
                    {t('modules.progressCount', { done: completed, count: tracked.length })}
                  </Text>
                  <Text variant="subhead" tone="muted" tabular>
                    {formatNumber(
                      Math.round((completed / tracked.length) * 100) / 100,
                      { style: 'percent', maximumFractionDigits: 0 },
                      locale,
                    )}
                  </Text>
                </View>
                <ProgressBar
                  value={completed / tracked.length}
                  accessibilityLabel={t('modules.progress')}
                />
              </Card>
            ) : null}
            {list.map((m) => (
              <ModuleSection
                key={m.id}
                module={m}
                modules={list}
                courseId={courseId}
                expanded={!collapsed.has(m.id)}
                onToggle={() => toggle(m.id)}
                onMarkDone={onMarkDone}
                markingId={markDone.isPending ? (markDone.variables?.itemId ?? null) : null}
                masteryPaths={masteryPaths.data}
              />
            ))}
          </>
        )}
      </Screen>
    </CourseScope>
  );
}
