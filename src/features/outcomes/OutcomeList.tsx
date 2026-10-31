import { ExternalLink, Target } from 'lucide-react-native';
import { FlatList, View } from 'react-native';

import { outcomeUnavailable, type OutcomeMastery, useOutcomes } from '@/canvas/api/outcomes';
import { Button, Callout, Card, EmptyState, Screen, Text } from '@/design';
import { useOutcomesPortfolioListBrowser } from '@/features/content/outcomesPortfolioListBrowserLifetime';
import { ListSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { useOnline } from '@/features/offline/useOnline';

import { useTranslation } from '@/i18n';

import { outcomePresentation } from './presentation';

function OutcomeRow({ outcome }: { outcome: OutcomeMastery }) {
  const { locale } = useTranslation();
  const labels = outcomePresentation(outcome, locale);
  return (
    <Card className="mb-3 gap-2">
      <Text variant="headline" accessibilityRole="header">{labels.title}</Text>
      <Text weight="medium" tone={outcome.status === 'mastered' ? 'success' : 'default'}>
        {labels.status}
      </Text>
      {outcome.score !== null ? (
        <Text>{labels.score}</Text>
      ) : null}
      {outcome.threshold !== null ? <Text tone="muted">{labels.threshold}</Text> : null}
      <Text variant="subhead" tone="muted">{labels.explanation}</Text>
    </Card>
  );
}

export function OutcomeList({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const query = useOutcomes(courseId);
  const online = useOnline();
  const refreshControl = useRefreshControl([['outcomes', courseId], ['courses', courseId, 'tabs']]);
  const unavailable = outcomeUnavailable(query.error) || query.data?.kind === 'disabled';
  // A fresh permission denial must suppress previously cached grades.
  const outcomes = !unavailable && query.data?.kind === 'available' ? query.data.outcomes : [];
  const data = query.data, queryError = query.error, kind = data?.kind;
  const sourceOutcomes = data?.kind === 'available' ? data.outcomes : undefined;
  const { open: openBrowser, opening, openError } = useOutcomesPortfolioListBrowser(
    online, [courseId, data, kind, sourceOutcomes, queryError, unavailable],
  );
  const open = () => openBrowser(`/courses/${encodeURIComponent(courseId)}/outcomes`,
    () => query.data === data && data?.kind === kind && query.error === queryError &&
      (data?.kind !== 'available' || data.outcomes === sourceOutcomes));
  const header = (
    <View className="mb-4 gap-4">
      <Text tone="muted">{t('outcomes.intro')}</Text>
      {!online ? <Callout title={t('contentLists.offline')}>{query.data ? t('outcomes.offlineCached') : t('outcomes.offlineEmpty')}</Callout> : null}
      {unavailable ? (
        <Callout title={t('outcomes.unavailable')}>
          {query.data?.kind === 'disabled' ? t('outcomes.disabled') : t('outcomes.restricted')}
        </Callout>
      ) : query.isError ? <LoadError title={t('outcomes.loadError')} error={query.error} onRetry={() => query.refetch()} /> : null}
      {openError ? <LoadError title={t('contentLists.openError')} error={openError} onRetry={open} /> : null}
      <Button variant="outline" leadingIcon={ExternalLink} disabled={!online} loading={opening !== null} onPress={open}>{t('outcomes.open')}</Button>
    </View>
  );
  return (
    <FlatList
      data={outcomes}
      keyExtractor={(outcome) => outcome.id}
      renderItem={({ item }) => <OutcomeRow outcome={item} />}
      // Keep Screen as the underlying native scroll view without nesting scroll views.
      renderScrollComponent={(props) => <Screen {...props} contentClassName="gap-0">{props.children}</Screen>}
      refreshControl={refreshControl}
      ListHeaderComponent={header}
      ListEmptyComponent={query.isPending ? <ListSkeleton /> : !unavailable && !query.isError ? (
        <EmptyState icon={Target} title={t('outcomes.empty')} description={t('outcomes.emptyDescription')} />
      ) : undefined}
    />
  );
}
