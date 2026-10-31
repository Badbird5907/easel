import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { useTranslation } from '@/i18n';

import { useAccountKey } from '@/canvas/query';
import { Callout, Card, Skeleton, useTheme } from '@/design';

/**
 * Pull to refresh for a screen: refetches every active query under the given
 * key prefixes (account prefix added), so embedded sections refresh too.
 */
export function useRefreshControl(prefixes: QueryKey[], onRefreshed?: () => void) {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all(
        prefixes.map((key) => queryClient.refetchQueries({ queryKey: [accountKey, ...key], type: 'active' })),
      );
      onRefreshed?.();
    } finally {
      setRefreshing(false);
    }
  };

  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.fgMuted} />;
}

/** Placeholder rows shaped like a list group. */
export function ListSkeleton({ rows = 4, leading = true }: { rows?: number; leading?: boolean }) {
  return (
    <Card padding="none">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} className="min-h-[60px] flex-row items-center gap-3 px-4 py-3">
          {leading ? <Skeleton className="h-9 w-9 rounded-lg" /> : null}
          <View className="flex-1 gap-2">
            <Skeleton className={i % 2 ? 'h-4 w-1/2' : 'h-4 w-3/4'} />
            <Skeleton className="h-3 w-1/3" />
          </View>
        </View>
      ))}
    </Card>
  );
}

/** Placeholder for a detail screen: title, a few facts, then body text. */
export function DetailSkeleton() {
  return (
    <View className="gap-6">
      <View className="gap-3">
        <Skeleton className="h-7 w-4/5" />
        <Skeleton className="h-5 w-1/3" />
      </View>
      <Card className="gap-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
      </Card>
      <View className="gap-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </View>
    </View>
  );
}

/** A failed load, with the reason and a retry. */
export function LoadError({ title, error, onRetry }: { title: string; error: Error; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Callout tone="danger" title={title} action={{ label: t('common.retry'), onPress: onRetry }}>
      {error.message}
    </Callout>
  );
}
