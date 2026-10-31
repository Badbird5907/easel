import { ExternalLink, FolderOpen } from 'lucide-react-native';
import { FlatList, View } from 'react-native';

import { ePortfoliosUnavailable, useEPortfolios } from '@/canvas/api/eportfolios';
import { Button, Callout, Card, EmptyState, Screen, Text } from '@/design';
import { useOutcomesPortfolioListBrowser } from '@/features/content/outcomesPortfolioListBrowserLifetime';
import { ListSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { useOnline } from '@/features/offline/useOnline';
import { useDisplayTimeZone } from '@/lib/dates';

import { useTranslation } from '@/i18n';

import { portfolioPresentation } from './presentation';

export function EPortfolioList() {
  const { t, locale } = useTranslation();
  const query = useEPortfolios();
  const online = useOnline();
  const timeZone = useDisplayTimeZone();
  const unavailable = ePortfoliosUnavailable(query.error);
  const refreshControl = useRefreshControl([['eportfolios', 'self']]);
  const data = query.data, queryError = query.error;
  const rows = (data ?? []).map(item => ({ item, id: item.id, path: item.path }));
  const { open, opening, openError } = useOutcomesPortfolioListBrowser(
    online, [data, queryError, unavailable, ...rows.flatMap(row => [row.item, row.id, row.path])],
  );
  const sourceCurrent = () => query.data === data && query.error === queryError &&
    (data?.length ?? 0) === rows.length && rows.every((row, index) =>
      data?.[index] === row.item && row.item.id === row.id && row.item.path === row.path);
  return (
    <FlatList
      data={unavailable ? [] : query.data ?? []}
      keyExtractor={(portfolio) => portfolio.id}
      renderScrollComponent={(props) => <Screen {...props} contentClassName="gap-0">{props.children}</Screen>}
      refreshControl={refreshControl}
      ListHeaderComponent={(
        <View className="mb-4 gap-4">
          <Text tone="muted">{t('portfolios.intro')}</Text>
          {!online ? <Callout title={t('contentLists.offline')}>{query.data ? t('portfolios.offlineCached') : t('portfolios.offlineEmpty')}</Callout> : null}
          {unavailable ? <Callout title={t('portfolios.unavailable')}>{t('portfolios.restricted')}</Callout>
            : query.isError ? <LoadError title={t('portfolios.loadError')} error={query.error} onRetry={() => query.refetch()} /> : null}
          {openError ? <Callout tone="danger" title={t('contentLists.openError')}>{openError.message}</Callout> : null}
          <Button variant="outline" leadingIcon={ExternalLink} disabled={!online || opening !== null} onPress={() => open('/dashboard/eportfolios', sourceCurrent)}>
            {t('portfolios.open')}
          </Button>
        </View>
      )}
      renderItem={({ item }) => {
        // Explicit locale and Canvas zone keep same-object cached rows reactive.
        const path = item.path, id = item.id;
        const labels = portfolioPresentation(item, locale, timeZone);
        return (
          <Card className="mb-3 gap-3">
            <Text variant="headline" accessibilityRole="header">{labels.title}</Text>
            <Text tone="muted">{labels.visibility}</Text>
            {labels.date ? <Text variant="subhead" tone="muted">{labels.date}</Text> : null}
            <Button variant="tonal" leadingIcon={ExternalLink} disabled={!online || opening !== null} loading={opening === item.path}
              accessibilityLabel={labels.openLabel} onPress={() => open(path, () => sourceCurrent() && !unavailable &&
                data?.includes(item) === true && item.id === id && item.path === path)}>
              {t('portfolios.openOne')}
            </Button>
          </Card>
        );
      }}
      ListEmptyComponent={query.isPending ? <ListSkeleton /> : !unavailable && !query.isError ? (
        <EmptyState icon={FolderOpen} title={t('portfolios.empty')} description={t('portfolios.emptyDescription')} />
      ) : undefined}
    />
  );
}
