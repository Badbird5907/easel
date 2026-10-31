import { router } from 'expo-router';
import {
  ClipboardCheck,
  FileText,
  Layers,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  NotebookText,
  Search,
  Sparkles,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { type MessageKey, useTranslation } from '@/i18n';

import {
  type SearchKind,
  type SearchResult,
  SmartSearchOff,
  searchTitles,
  useSearchIndex,
  useSearchMode,
  useSmartSearch,
} from '@/canvas/api/search';
import { useCanvas } from '@/canvas/session';
import { Callout, Card, EmptyState, Icon, IconTile, ListGroup, ListItem, SearchField, Skeleton, Text } from '@/design';
import { openCanvasLink } from '@/features/content/links';
import { ListSkeleton } from '@/features/course/states';

const kindInfo: Record<SearchKind, { title: MessageKey; icon: LucideIcon; label: MessageKey }> = {
  assignment: { title: 'search.kind.assignment', icon: FileText, label: 'search.label.assignment' },
  quiz: { title: 'search.kind.quiz', icon: ClipboardCheck, label: 'search.label.quiz' },
  discussion: { title: 'search.kind.discussion', icon: MessageSquare, label: 'search.label.discussion' },
  announcement: { title: 'search.kind.announcement', icon: Megaphone, label: 'search.label.announcement' },
  page: { title: 'search.kind.page', icon: NotebookText, label: 'search.label.page' },
  module: { title: 'search.kind.module', icon: Layers, label: 'search.label.module' },
};

const order: SearchKind[] = ['assignment', 'quiz', 'discussion', 'announcement', 'page', 'module'];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Opens a result in its native screen. */
function openResult(courseId: string, r: SearchResult, baseUrl: string) {
  const push = (pathname: string, params: Record<string, string>) =>
    router.push({ pathname, params: { courseId, ...params } } as never);
  switch (r.kind) {
    case 'quiz':
      if (r.quizId) return push('/course/[courseId]/quiz/[quizId]', { quizId: r.quizId });
      return push('/course/[courseId]/assignment/[assignmentId]', { assignmentId: r.id });
    case 'assignment':
      if (r.discussionTopicId) return push('/course/[courseId]/discussion/[topicId]', { topicId: r.discussionTopicId });
      return push('/course/[courseId]/assignment/[assignmentId]', { assignmentId: r.id });
    case 'discussion':
    case 'announcement':
      return push('/course/[courseId]/discussion/[topicId]', { topicId: r.id });
    case 'page':
      if (r.pageUrl) return push('/course/[courseId]/page/[pageUrl]', { pageUrl: r.pageUrl });
      if (r.htmlUrl) return openCanvasLink(r.htmlUrl, baseUrl);
      return;
    case 'module':
      return push('/course/[courseId]/modules', {});
  }
}

function ResultGroups({ courseId, results, smart }: { courseId: string; results: SearchResult[]; smart: boolean }) {
  const { t } = useTranslation();
  const { account } = useCanvas();
  // Grouped by type. Smart search keeps its ranking: the type with the best match comes first.
  const kinds = smart ? [...new Set(results.map((r) => r.kind))] : order;
  const groups = kinds
    .map((kind) => ({ kind, items: results.filter((r) => r.kind === kind) }))
    .filter((g) => g.items.length);
  return (
    <View className="gap-5">
      {groups.map((g) => (
        <ListGroup key={g.kind} header={t(kindInfo[g.kind].title)}>
          {g.items.map((r) => {
            const info = kindInfo[r.kind];
            const subtitle = r.snippet ?? undefined;
            return (
              <ListItem
                key={r.key}
                leading={<IconTile icon={info.icon} tone="accent" />}
                title={r.title}
                subtitle={subtitle || undefined}
                subtitleLines={2}
                accessibilityLabel={[t(info.label), r.title, r.snippet].filter(Boolean).join(', ')}
                onPress={() => openResult(courseId, r, account.baseUrl)}
              />
            );
          })}
        </ListGroup>
      ))}
    </View>
  );
}

/**
 * Searches one course (COURSE-6): Canvas's smart search where the school
 * turns it on, otherwise the titles of the course's assignments, pages,
 * modules, and discussions.
 */
export function CourseSearch({ courseId, initialQuery = '' }: { courseId: string; initialQuery?: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const term = useDebounced(query.trim(), 350);
  const mode = useSearchMode(courseId);
  const [smartOff, setSmartOff] = useState(false);
  const smart = mode.data === 'smart' && !smartOff;
  const results = useSmartSearch(courseId, term, smart);
  const index = useSearchIndex(courseId, mode.isSuccess && !smart);

  // Canvas refusing smart search after all (403) means titles only.
  const refused = results.error instanceof SmartSearchOff;
  if (refused && !smartOff) setSmartOff(true);

  const titleMatches = useMemo(() => searchTitles(index.data?.results ?? [], term), [index.data, term]);
  const list = smart ? (results.data ?? []) : titleMatches;
  const loading = smart ? results.isFetching && !results.data : index.isPending;

  return (
    <View className="gap-5">
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={smart ? t('course.search') : t('search.titles')}
        autoFocus
        accessibilityHint={
          smart
            ? t('search.smartHint')
            : t('search.titlesHint')
        }
      />
      {mode.isPending ? (
        <Skeleton className="h-4 w-1/2" />
      ) : (
        <View className="flex-row items-start gap-1.5 px-1">
          <View className="pt-0.5">
            <Icon icon={smart ? Sparkles : Search} size={14} tone="muted" />
          </View>
          <Text variant="footnote" tone="muted" className="flex-1">
            {smart
              ? t('search.smartHelp')
              : t('search.titlesHelp')}
          </Text>
        </View>
      )}

      {!smart && index.data?.unavailable.map((kind) => (
        <Callout key={kind} tone="warning" title={t('search.partial', { category: t(kindInfo[kind].title) })}
          action={{ label: t('common.retry'), onPress: () => index.refetch() }}>{null}</Callout>
      ))}
      {!term ? (
        <Card padding="none">
          <EmptyState
            icon={Search}
            title={t('course.search')}
            description={
              smart
                ? t('search.smartPrompt')
                : t('search.titlesPrompt')
            }
          />
        </Card>
      ) : smart && term.length < 2 ? null : loading ? (
        <ListSkeleton rows={4} />
      ) : smart && results.isError && !refused ? (
        <Callout
          tone="danger"
          title={t('search.error')}
          action={{ label: t('common.retry'), onPress: () => results.refetch() }}
        >
          {results.error.message}
        </Callout>
      ) : !smart && index.isError ? (
        <Callout tone="danger" title={t('search.contentError')} action={{ label: t('common.retry'), onPress: () => index.refetch() }}>
          {index.error.message}
        </Callout>
      ) : list.length === 0 ? (
        <Text variant="subhead" tone="muted" align="center" className="py-8" accessibilityLiveRegion="polite">
          {t('search.noMatches', { query: term })}
        </Text>
      ) : (
        <>
          <Text variant="footnote" tone="muted" className="sr-only" accessibilityLiveRegion="polite">
            {t('search.results', { count: list.length })}
          </Text>
          <ResultGroups courseId={courseId} results={list} smart={smart} />
        </>
      )}
    </View>
  );
}
