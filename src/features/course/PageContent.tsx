import { router, Stack, usePreventRemove } from 'expo-router';
import { Lock, NotebookText, Pencil } from 'lucide-react-native';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { Alert, type ScrollView, View } from 'react-native';

import {
  fetchLatestRevision,
  FRONT_PAGE,
  type Page,
  type PageContext,
  type Revision,
  useContextPage,
  useContextPages,
  useUpdatePage,
} from '@/canvas/api/pages';
import { useCanvas } from '@/canvas/session';
import {
  AccentScope,
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  haptics,
  Icon,
  IconTile,
  ListGroup,
  ListItem,
  Screen,
  SearchField,
  Text,
} from '@/design';
import { RichContent } from '@/features/content/RichContent';
import { RichEditor } from '@/features/editor/RichEditor';
import { useContextLabel } from '@/features/groups/context';
import { useTranslation } from '@/i18n';
import { createDateContext, useDisplayTimeZone } from '@/lib/dates';

import { pageRevisionAge } from './pagePresentation';
import { DetailSkeleton, ListSkeleton, LoadError } from './states';

/** Where a page opens in a course or group. */
export function pageRoute(context: PageContext, pageUrl: string) {
  return context.type === 'course'
    ? { pathname: '/course/[courseId]/page/[pageUrl]', params: { courseId: context.id, pageUrl } }
    : { pathname: '/group/[groupId]/page/[pageUrl]', params: { groupId: context.id, pageUrl } };
}

/** A course's or group's pages, front page first, with search once there are many (CONTENT-8). */
export function PageList({ context }: { context: PageContext }) {
  const { t, locale } = useTranslation();
  const timeZone = useDisplayTimeZone();
  const dates = createDateContext(locale, timeZone);
  const pages = useContextPages(context);
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const all = pages.data ?? [];
  const visible = term ? all.filter((p) => p.title.toLowerCase().includes(term)) : all;

  if (pages.isPending) return <ListSkeleton rows={5} />;
  if (pages.isError)
    return <LoadError title={t('pages.loadError')} error={pages.error} onRetry={() => pages.refetch()} />;
  if (all.length === 0)
    return (
      <Card padding="none">
        <EmptyState
          icon={NotebookText}
          title={t('pages.empty')}
          description={
            context.type === 'course'
              ? t('pages.emptyCourse')
              : t('pages.emptyGroup')
          }
        />
      </Card>
    );
  return (
    <>
      {all.length > 8 ? <SearchField value={search} onChangeText={setSearch} placeholder={t('pages.search')} /> : null}
      {visible.length === 0 ? (
        <Text variant="subhead" tone="muted" align="center" className="py-6">
          {t('pages.noMatch', { search: search.trim() })}
        </Text>
      ) : (
        <ListGroup>
          {visible.map((page) => {
            const subtitle = [
              page.isFrontPage ? t('pages.frontPage') : null,
              t('pages.updated', { date: dates.formatShortDate(page.updatedAt) }),
              page.editable ? t('pages.canEdit') : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <ListItem
                key={page.url}
                leading={<IconTile icon={NotebookText} tone={page.locked ? 'neutral' : 'accent'} />}
                title={page.title}
                subtitle={subtitle}
                subtitleLines={1}
                trailing={page.locked ? <Icon icon={Lock} size={16} tone="subtle" /> : undefined}
                accessibilityLabel={[page.title, subtitle, page.locked ? t('pages.locked') : null].filter(Boolean).join(', ')}
                onPress={() => router.push(pageRoute(context, page.url) as never)}
              />
            );
          })}
        </ListGroup>
      )}
    </>
  );
}

/** Where "Edit" goes for a page in a course or group (CONTENT-8). */
export function pageEditRoute(context: PageContext, pageUrl: string) {
  return context.type === 'course'
    ? { pathname: '/course/[courseId]/page/[pageUrl]/edit', params: { courseId: context.id, pageUrl } }
    : { pathname: '/group/[groupId]/page/[pageUrl]/edit', params: { groupId: context.id, pageUrl } };
}

export function PageBody({ page, onEdit }: { page: Page; onEdit?: () => void }) {
  const { t, locale } = useTranslation();
  const timeZone = useDisplayTimeZone();
  const dates = createDateContext(locale, timeZone);
  const date = dates.formatShortDate(page.updatedAt);
  const updated = page.editedBy
    ? t('pages.updatedBy', { date, name: page.editedBy })
    : t('pages.updated', { date });
  return (
    <>
      <View className="gap-2">
        <Text variant="title2" accessibilityRole="header">
          {page.title}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          {page.isFrontPage ? <Badge tone="accent">{t('pages.frontPage')}</Badge> : null}
          <Text variant="footnote" tone="muted">
            {updated}
          </Text>
        </View>
        {onEdit && page.editable ? (
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={Pencil}
            onPress={onEdit}
            className="mt-1 self-start"
            accessibilityHint={t('pages.editHint')}
          >
            {t('pages.edit')}
          </Button>
        ) : null}
      </View>
      {page.locked ? (
        <Callout tone="warning" icon={Lock} title={t('pages.locked')}>
          {page.lockExplanation ?? t('pages.lockExplanation')}
        </Callout>
      ) : page.html.trim() ? (
        <RichContent html={page.html} />
      ) : (
        <Text variant="body" tone="muted">
          {t('pages.emptyBody')}
        </Text>
      )}
    </>
  );
}

/**
 * Loads and renders a page (CONTENT-8), with Edit when students may edit it.
 * Used by the page screens and module items. `courseId` is shorthand for a
 * course page; pass `context` for a group's.
 */
export function PageContent({
  courseId,
  context,
  pageUrl,
}: {
  courseId?: string;
  context?: PageContext;
  pageUrl: string;
}) {
  const { t } = useTranslation();
  const where: PageContext = context ?? { type: 'course', id: courseId ?? '' };
  const query = useContextPage(where, pageUrl);
  if (query.isPending) return <DetailSkeleton />;
  if (query.isError)
    return <LoadError title={t('pages.pageLoadError')} error={query.error} onRetry={() => query.refetch()} />;
  return (
    <PageBody
      page={query.data}
      onEdit={() => router.push(pageEditRoute(where, query.data.url) as never)}
    />
  );
}

/**
 * Edits a page's body with the rich editor (CONTENT-8). Canvas saves the last
 * write, so before saving this checks whether someone else saved a newer
 * revision since editing began, and lets the student choose.
 */
export function PageEditor({ context, pageUrl }: { context: PageContext; pageUrl: string }) {
  const { t, locale } = useTranslation();
  const timeZone = useDisplayTimeZone();
  const { client } = useCanvas();
  const { color } = useContextLabel(context);
  const page = useContextPage(context, pageUrl);
  const update = useUpdatePage();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollProps = { ref: scrollRef } as object;
  const [html, setHtml] = useState<string | null>(null);
  const [base, setBase] = useState<Revision | null>(null);
  const [checking, setChecking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<{ kind: 'save' | 'reload'; message: string | null } | null>(null);
  const loaded = page.data;
  const canEdit = !!loaded?.editable && !page.isError && !page.isPending;
  const editPermission = useRef(false);
  useEffect(() => {
    editPermission.current = canEdit;
    return () => { editPermission.current = false; };
  }, [canEdit]);

  // The editing session starts from the body on screen now, and the revision it came from.
  if (loaded && html === null) setHtml(loaded.html);
  const realUrl = loaded?.url;
  useEffect(() => {
    if (!realUrl) return;
    let cancelled = false;
    fetchLatestRevision(client, context, realUrl)
      .then((revision) => !cancelled && setBase((current) => current ?? revision))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [realUrl, client, context]);

  const dirty = !leaving && edited;
  const allowLeave = usePreventRemove(dirty, ({ repeat }) =>
    Alert.alert(t('pages.discardTitle'), t('pages.discardBody'), [
      { text: t('pages.keepEditing'), style: 'cancel' },
      {
        text: t('pages.discard'),
        style: 'destructive',
        onPress: () => {
          setLeaving(true);
          repeat();
        },
      },
    ]),
  );

  const write = () => {
    // Alert callbacks may outlive the query result that created them.
    if (!editPermission.current || !loaded || html === null) return;
    setError(null);
    update.mutate(
      { context, pageUrl: loaded.url, html },
      {
        onSuccess: () => {
          haptics.success();
          setLeaving(true);
          allowLeave();
          router.back();
        },
        onError: (e) => {
          haptics.error();
          setError({ kind: 'save', message: e.message });
        },
      },
    );
  };

  const save = async () => {
    if (!editPermission.current || !loaded || html === null) return;
    setChecking(true);
    let latest: Revision | null = null;
    try {
      latest = await fetchLatestRevision(client, context, loaded.url);
    } catch {
      // Revisions can be off for students; save without the check.
    } finally {
      setChecking(false);
    }
    if (!editPermission.current) return;
    if (!base || !latest || latest.id === base.id) {
      write();
      return;
    }
    const who = latest.editedBy ?? t('pages.someone');
    Alert.alert(
      t('pages.conflictTitle'),
      t('pages.conflictBody', { name: who, age: pageRevisionAge(latest.updatedAt, locale, timeZone) }),
      [
        { text: t('pages.keepEditing'), style: 'cancel' },
        {
          text: t('pages.useTheirs'),
          onPress: async () => {
            setChecking(true);
            setError(null);
            try {
              const fresh = await page.refetch();
              // Failed refetches can still carry the previous cached page.
              if (fresh.isError || !fresh.data) {
                setError({ kind: 'reload', message: fresh.error?.message ?? null });
                return;
              }
              setHtml(fresh.data.html);
              setEdited(false);
              setBase(latest);
            } catch (error) {
              setError({ kind: 'reload', message: error instanceof Error ? error.message : null });
            } finally {
              setChecking(false);
            }
          },
        },
        { text: t('pages.saveMine'), style: 'destructive', onPress: write },
      ],
    );
  };

  const busy = checking || update.isPending;

  return (
    <>
      <Stack.Screen
        options={{
          title: t('pages.edit'),
          // The header sits outside the screen's accent scope, so the button carries its own.
          headerRight: () => (
            <AccentScope color={color}>
              <Button size="sm" disabled={!canEdit || !dirty || busy} loading={busy} onPress={() => void save()} className="me-2">
                {t('pages.save')}
              </Button>
            </AccentScope>
          ),
        }}
      />
      <Screen {...scrollProps} automaticallyAdjustKeyboardInsets contentClassName="gap-5">
        {page.isPending ? (
          <DetailSkeleton />
        ) : page.isError ? (
          <LoadError title={t('pages.pageLoadError')} error={page.error} onRetry={() => page.refetch()} />
        ) : !page.data.editable ? (
          <Callout tone="info" icon={Lock} title={t('pages.noPermission')}>
            {t('pages.onlyInstructor')}
          </Callout>
        ) : (
          <>
            <View className="gap-1">
              <Text variant="title3" accessibilityRole="header">
                {page.data.title}
              </Text>
              <Text variant="footnote" tone="muted">
                {t(pageUrl === FRONT_PAGE ? 'pages.editFrontDescription' : 'pages.editDescription')}
              </Text>
            </View>
            {error ? (
              <Callout tone="danger" title={t(error.kind === 'reload' ? 'pages.pageLoadError' : 'pages.saveError')}>
                {error.message ?? t('pages.reloadFailed')}
              </Callout>
            ) : null}
            {html !== null ? (
              <RichEditor
                label={t('pages.page')}
                value={html}
                onChange={(next) => {
                  setHtml(next);
                  setEdited(true);
                }}
                minHeight={280}
                editable={!busy}
                scrollViewRef={scrollRef}
              />
            ) : null}
          </>
        )}
      </Screen>
    </>
  );
}
