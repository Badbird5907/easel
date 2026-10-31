import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  ExternalLink,
  Hourglass,
  Lock,
  Signpost,
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  type MasteryPath,
  type MasteryPathOption,
  type ModuleItem,
  useMasteryPaths,
  useModules,
  useSelectMasteryPath,
} from '@/canvas/api/modules';
import { CanvasError, CanvasNetworkError } from '@/canvas/client';
import { useAccountKey } from '@/canvas/query';
import { useCanvas } from '@/canvas/session';
import {
  Button,
  Callout,
  Card,
  Divider,
  haptics,
  Icon,
  IconTile,
  ListGroup,
  ListItem,
  PressableScale,
  Text,
} from '@/design';
import { predictOpenMode, useLaunchTool } from '@/features/lti/launch';
import { useToolAction } from '@/features/lti/action';
import { useToolLifetime } from '@/features/lti/lifetime';
import { useToolOpenMode } from '@/features/lti/preferences';
import { ToolOpenModeControl } from '@/features/lti/ToolOpenChoice';
import { OfflineError } from '@/features/offline/connectivity';
import { useOnline } from '@/features/offline/useOnline';
import { NewQuizLaunch } from '@/features/quizzes/NewQuizLaunch';
import { cn } from '@/lib/cn';

import { useTranslation } from '@/i18n';
import { useDisplayTimeZone } from '@/lib/dates';

import { AssignmentDetails, assignmentKindIcon } from './AssignmentDetails';
import { createModulePresentation } from './modulePresentation';
import { masteryPathState, moduleItemIcon } from './ModuleList';
import { discussionTarget, fileTarget, pushRoute } from './navigation';
import { PageContent } from './PageContent';
import { QuizDetails } from './QuizDetails';
import { DetailSkeleton, LoadError } from './states';

/** A module item Easel opens somewhere else: a discussion, file, link, or tool. */
function OpenElsewhere({
  item,
  detail,
  action,
  note,
  external,
  onPress,
  context,
}: {
  item: ModuleItem;
  detail: string;
  action: string;
  note?: string;
  external?: boolean;
  onPress: (isCurrent: () => boolean) => void | Promise<void>;
  context?: { active: boolean };
}) {
  const { t } = useTranslation();
  const control = useToolAction(
    JSON.stringify([
      item.id,
      item.moduleId,
      item.type,
      item.contentId,
      item.externalUrl,
      item.htmlUrl,
      item.pageUrl,
    ]),
    !item.locked,
    context,
  );
  const opening = control.pending;
  const open = () => control.run(onPress);
  return (
    <>
      <View className="flex-row items-center gap-3">
        <IconTile icon={moduleItemIcon[item.type]} size="lg" tone={item.locked ? 'neutral' : 'accent'} />
        <View className="flex-1 gap-0.5">
          <Text variant="title3" accessibilityRole="header">
            {item.title}
          </Text>
          <Text variant="subhead" tone="muted" numberOfLines={2}>
            {detail}
          </Text>
        </View>
      </View>
      {item.locked ? (
        <Callout tone="warning" icon={Lock} title={t('modules.locked')}>
          {item.lockExplanation ?? t('modules.itemLocked')}
        </Callout>
      ) : (
        <View className="gap-2">
          <Button
            trailingIcon={external ? ExternalLink : undefined}
            loading={opening}
            onPress={open}
            accessibilityHint={external ? t('modules.toolBrowserNote') : undefined}
          >
            {action}
          </Button>
          {note ? (
            <Text variant="footnote" tone="muted" align="center">
              {note}
            </Text>
          ) : null}
        </View>
      )}
    </>
  );
}

const hostOf = (url: string | null) => {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** An ExternalTool item: launched with `launch_type=module_item`, where the student chose (LTI-1, LTI-2). */
function ToolItem({ item, courseId }: { item: ModuleItem; courseId: string }) {
  const { t } = useTranslation();
  const { account, client } = useCanvas();
  const context = useToolLifetime(
    JSON.stringify([
      account.id,
      account.baseUrl,
      courseId,
      item.id,
      item.moduleId,
      item.contentId,
      item.type,
      item.externalUrl,
      item.htmlUrl,
      item.locked,
    ]),
    client,
  );
  const launchTool = useLaunchTool();
  const fallback = predictOpenMode(null, item.externalUrl, account.baseUrl);
  const { mode } = useToolOpenMode(account.id, item.contentId, fallback);
  const browser = mode === 'browser';
  return (
    <>
      <OpenElsewhere
        context={context}
        item={item}
        detail={hostOf(item.externalUrl) ?? t('modules.kind.ExternalTool')}
        action={browser ? t('modules.openToolBrowser') : t('modules.openTool')}
        note={browser ? undefined : t('modules.toolAppNote')}
        external={browser}
        onPress={(isCurrent) =>
          launchTool(
            {
              courseId,
              moduleItemId: item.id,
              moduleId: item.moduleId,
              url: item.externalUrl ?? undefined,
              title: item.title,
              fallbackUrl: item.htmlUrl ?? undefined,
            },
            { isCurrent },
          )
        }
      />
      {!item.locked && item.contentId ? (
        <Card>
          <ToolOpenModeControl toolId={item.contentId} fallback={fallback} />
        </Card>
      ) : null}
    </>
  );
}

/** The item itself, rendered the way its own screen would (CONTENT-7). */
export function ModuleItemContent({ item, courseId }: { item: ModuleItem; courseId: string }) {
  const { t } = useTranslation();
  if (item.locked)
    return (
      <Callout tone="warning" icon={Lock} title={t('modules.locked')}>
        {item.lockExplanation ?? t('modules.itemLocked')}
      </Callout>
    );
  switch (item.type) {
    case 'Assignment':
      // New Quizzes are assignments backed by an LTI tool (QUIZ-8).
      if (item.quizLti && item.contentId)
        return (
          <NewQuizLaunch
            courseId={courseId}
            assignmentId={item.contentId}
            title={item.title}
            dueAt={item.dueAt}
            points={item.points}
            locked={item.locked}
            lockExplanation={item.lockExplanation}
            canvasUrl={item.htmlUrl}
          />
        );
      return item.contentId ? <AssignmentDetails courseId={courseId} assignmentId={item.contentId} /> : null;
    case 'Quiz':
      return item.contentId ? <QuizDetails courseId={courseId} quizId={item.contentId} /> : null;
    case 'Page':
      return item.pageUrl ? <PageContent courseId={courseId} pageUrl={item.pageUrl} /> : null;
    case 'Discussion':
      return (
        <OpenElsewhere
          item={item}
          detail={t('modules.kind.Discussion')}
          action={t('modules.openDiscussion')}
          onPress={() => {
            if (item.contentId) pushRoute(discussionTarget(courseId, item.contentId, item.htmlUrl));
          }}
        />
      );
    case 'File':
      if (!item.contentId)
        return (
          <Callout tone="warning" title={t('modules.itemMissing')}>
            {t('modules.itemMissingDescription')}
          </Callout>
        );
      return (
        <OpenElsewhere
          item={item}
          detail={t('modules.kind.File')}
          action={t('modules.openFile')}
          onPress={() => {
            if (item.contentId) pushRoute(fileTarget(item.contentId, courseId));
          }}
        />
      );
    case 'ExternalUrl':
      return (
        <OpenElsewhere
          item={item}
          detail={hostOf(item.externalUrl) ?? t('modules.kind.ExternalUrl')}
          action={t('modules.openLink')}
          external
          onPress={() =>
            item.externalUrl ? WebBrowser.openBrowserAsync(item.externalUrl).then(() => {}) : undefined
          }
        />
      );
    case 'ExternalTool':
      return <ToolItem item={item} courseId={courseId} />;
    case 'SubHeader':
      return (
        <Text variant="title3" accessibilityRole="header">
          {item.title}
        </Text>
      );
  }
}

/** What completes this item, with "Mark done" when that's the requirement (CONTENT-6). */
export function RequirementCard({
  item,
  onSetDone,
  busy,
}: {
  item: ModuleItem;
  onSetDone: (done: boolean) => void;
  busy: boolean;
}) {
  const { t, locale } = useTranslation();
  const timeZone = useDisplayTimeZone();
  const p = createModulePresentation(locale, timeZone);
  const req = item.requirement;
  if (!req || item.type === 'SubHeader') return null;
  const done = req.completed === true;

  if (req.type === 'must_mark_done') {
    return (
      <Card className="flex-row items-center gap-3">
        <IconTile icon={done ? CircleCheck : Circle} tone={done ? 'success' : 'accent'} />
        <Text variant="callout" weight="medium" className="flex-1">
          {done ? t('modules.markedDone') : p.requirementInstruction(req)}
        </Text>
        {item.locked && !done ? null : (
          <Button
            size="sm"
            variant={done ? 'secondary' : 'primary'}
            loading={busy}
            accessibilityLabel={done ? t('modules.markAsNotDone') : t('modules.markAsDone')}
            onPress={() => onSetDone(!done)}
          >
            {done ? t('modules.undo') : t('modules.markDone')}
          </Button>
        )}
      </Card>
    );
  }

  // Opening the item fulfills a view requirement, so there's nothing to say until it's done.
  if (req.type === 'must_view' && !done) return null;
  return (
    <View
      className="flex-row items-center gap-2 px-1"
      accessible
      accessibilityLabel={
        done
          ? t('modules.completeRequirement', { requirement: p.requirementLabel(req) })
          : p.requirementInstruction(req)
      }
    >
      <Icon icon={done ? CircleCheck : Circle} size={18} tone={done ? 'success' : 'muted'} />
      <Text variant="subhead" tone={done ? 'success' : 'muted'} className="flex-1">
        {done
          ? t('modules.completeRequirement', { requirement: p.requirementLabel(req) })
          : p.requirementInstruction(req)}
      </Text>
    </View>
  );
}

function StepButton({
  item,
  direction,
  onPress,
}: {
  item: ModuleItem | null;
  direction: 'previous' | 'next';
  onPress: (item: ModuleItem) => void;
}) {
  const { t, locale } = useTranslation();
  const timeZone = useDisplayTimeZone();
  const p = createModulePresentation(locale, timeZone);
  if (!item) return <View className="flex-1" />;
  const next = direction === 'next';
  const label = next ? t('modules.next') : t('modules.previous');
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('modules.sequenceLabel', {
        direction: label,
        title: item.title,
        kind: p.kind(item.type),
      })}
      onPress={() => onPress(item)}
      className={cn(
        'min-h-[52px] flex-1 items-center gap-2 rounded-2xl bg-surface px-3 py-2',
        next ? 'flex-row-reverse' : 'flex-row',
      )}
      style={{ borderCurve: 'continuous' }}
    >
      <Icon icon={next ? ChevronRight : ChevronLeft} size={18} tone="accent" flipInRTL />
      <View className={cn('flex-1', next && 'items-end')}>
        <Text variant="caption" tone="muted">
          {label}
        </Text>
        <Text variant="subhead" weight="medium" numberOfLines={1}>
          {item.title}
        </Text>
      </View>
    </PressableScale>
  );
}

/** Previous and next across the course's module sequence, pinned above the home indicator. */
export function SequenceBar({
  prev,
  next,
  onGo,
}: {
  prev: ModuleItem | null;
  next: ModuleItem | null;
  onGo: (item: ModuleItem) => void;
}) {
  const insets = useSafeAreaInsets();
  if (!prev && !next) return null;
  return (
    <View className="bg-bg">
      <Divider />
      <View className="flex-row gap-3 px-4 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
        <StepButton item={prev} direction="previous" onPress={onGo} />
        <StepButton item={next} direction="next" onPress={onGo} />
      </View>
    </View>
  );
}

// Mastery paths (ASSIGN-15) ----------------------------------------------------

const pathsRoute = (courseId: string, itemId: string) => ({
  pathname: '/course/[courseId]/module-item/[itemId]/paths',
  params: { courseId, itemId },
});

/** On the trigger item's screen: the paths its score opens, or why there's no choice yet. */
export function MasteryPathCard({ item, courseId }: { item: ModuleItem; courseId: string }) {
  const { t } = useTranslation();
  const modules = useModules(courseId);
  const paths = useMasteryPaths(courseId, modules.data);
  const path = paths.data?.[item.id];
  if (!path) return null;
  const module = modules.data?.find((m) => m.id === item.moduleId);
  const state = masteryPathState(path, module);
  if (state === 'released') return null;
  if (state === 'choose')
    return (
      <Card className="gap-4">
        <View className="flex-row items-center gap-3">
          <IconTile icon={Signpost} />
          <View className="flex-1 gap-0.5">
            <Text variant="headline" accessibilityRole="header">
              {t('modules.chooseYourPath')}
            </Text>
            <Text variant="subhead" tone="muted">
              {t('modules.scoreOpenedDescription', { count: path.options.length })}
            </Text>
          </View>
        </View>
        <Button onPress={() => pushRoute(pathsRoute(courseId, item.id))}>{t('modules.seeOptions')}</Button>
      </Card>
    );
  return (
    <Callout
      tone="info"
      icon={state === 'locked' ? Lock : Hourglass}
      title={state === 'locked' ? t('modules.pathsLocked') : t('modules.addingPath')}
    >
      {state === 'locked' ? t('modules.scoreDecidesDescription') : t('modules.addingDescription')}
    </Callout>
  );
}

type SelectFailure =
  { kind: 'offline' | 'network' | 'changed' | 'unknown' } | { kind: 'detail'; detail: string };

function selectFailure(error: unknown): SelectFailure {
  if (error instanceof OfflineError) return { kind: 'offline' };
  if (error instanceof CanvasNetworkError) return { kind: 'network' };
  if (error instanceof CanvasError && error.status === 404) return { kind: 'changed' };
  return error instanceof Error && error.message
    ? { kind: 'detail', detail: error.message }
    : { kind: 'unknown' };
}

function OptionAssignments({ option }: { option: MasteryPathOption }) {
  const { t, locale } = useTranslation();
  const timeZone = useDisplayTimeZone();
  const p = createModulePresentation(locale, timeZone);
  if (!option.assignments.length)
    return (
      <Text variant="subhead" tone="muted" className="px-1">
        {t('modules.emptyOption')}
      </Text>
    );
  return (
    <ListGroup>
      {option.assignments.map((a) => (
        <ListItem
          key={a.id}
          leading={<IconTile icon={assignmentKindIcon[a.kind]} />}
          title={a.name}
          subtitle={[a.dueAt ? p.due(a.dueAt) : t('modules.noDue'), p.points(a.points)]
            .filter(Boolean)
            .join(' · ')}
          accessibilityLabel={[a.name, a.dueAt ? p.due(a.dueAt) : t('modules.noDue'), p.points(a.points)]
            .filter(Boolean)
            .join(', ')}
        />
      ))}
    </ListGroup>
  );
}

/**
 * The paths a trigger item's score opened, and choosing one (ASSIGN-15,
 * `select_mastery_path`). Canvas then assigns that option's assignments.
 */
export function MasteryPathChooser({ courseId, itemId }: { courseId: string; itemId: string }) {
  const { t, locale } = useTranslation();
  const accountKey = useAccountKey();
  const modules = useModules(courseId);
  const paths = useMasteryPaths(courseId, modules.data);
  const select = useSelectMasteryPath(courseId);
  const online = useOnline();
  const [failure, setFailure] = useState<SelectFailure | null>(null);

  const item = modules.data?.flatMap((m) => m.items).find((i) => i.id === itemId);
  const module = modules.data?.find((m) => m.id === item?.moduleId);
  const path: MasteryPath | undefined = paths.data?.[itemId];
  const selectionScope = JSON.stringify([accountKey, courseId, itemId]);
  const currentChoice = useRef<{ scope: string; path: MasteryPath | undefined; canChoose: boolean } | null>(
    null,
  );
  const claimed = useRef(new Set<string>());
  useEffect(() => {
    currentChoice.current = {
      scope: selectionScope,
      path,
      canChoose: !!(
        online &&
        !select.isPending &&
        !modules.isError &&
        !paths.isError &&
        !modules.isPending &&
        !paths.isPending &&
        item &&
        path &&
        !path.selectedId &&
        masteryPathState(path, module) === 'choose'
      ),
    };
    return () => {
      currentChoice.current = null;
    };
  }, [
    online,
    select.isPending,
    modules.isError,
    paths.isError,
    modules.isPending,
    paths.isPending,
    item,
    path,
    module,
    selectionScope,
  ]);

  if (modules.isError)
    return (
      <LoadError title={t('modules.loadError')} error={modules.error} onRetry={() => modules.refetch()} />
    );
  if (paths.isError)
    return (
      <LoadError title={t('modules.pathsLoadError')} error={paths.error} onRetry={() => paths.refetch()} />
    );
  if (modules.isPending || (paths.isPending && paths.fetchStatus !== 'idle')) return <DetailSkeleton />;
  if (!item || !path)
    return (
      <Callout
        tone="warning"
        title={t('modules.noPaths')}
        action={{ label: t('modules.tryAgain'), onPress: () => modules.refetch() }}
      >
        {t('modules.noPathsDescription')}
      </Callout>
    );

  const state = masteryPathState(path, module);
  const chosen = path.options.find((o) => o.id === path.selectedId) ?? null;

  const choose = async (option: MasteryPathOption) => {
    // A native Alert can remain open while connectivity, queries or the route change.
    const current = currentChoice.current;
    if (
      !current?.canChoose ||
      !current.path ||
      current.scope !== selectionScope ||
      current.path.moduleId !== path.moduleId ||
      !current.path.options.some((candidate) => candidate.id === option.id) ||
      claimed.current.has(selectionScope)
    )
      return;
    // Claim synchronously, before the mutation's pending render, and retain successful choices.
    claimed.current.add(selectionScope);
    setFailure(null);
    try {
      await select.mutateAsync({ moduleId: path.moduleId, itemId, setId: option.id });
      if (currentChoice.current?.scope !== selectionScope) return;
      haptics.success();
      AccessibilityInfo.announceForAccessibility(t('modules.optionChosen', { position: option.position }));
      if (router.canGoBack()) router.back();
    } catch (error) {
      claimed.current.delete(selectionScope);
      if (currentChoice.current?.scope !== selectionScope) return;
      haptics.error();
      setFailure(selectFailure(error));
    }
  };

  const confirm = (option: MasteryPathOption) => {
    const names = option.assignments.map((a) => `“${a.name}”`);
    Alert.alert(
      t('modules.confirmTitle', { position: option.position }),
      [
        names.length
          ? t('modules.confirmAdds', {
              names: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names),
            })
          : null,
        t('modules.confirmWarning'),
      ]
        .filter(Boolean)
        .join(' '),
      [
        { text: t('modules.cancel'), style: 'cancel' },
        {
          text: t('modules.chooseOption', { position: option.position }),
          onPress: () => choose(option),
        },
      ],
    );
  };

  return (
    <>
      <View className="gap-1.5">
        <Text variant="title2" accessibilityRole="header">
          {state === 'choose' ? t('modules.chooseYourPath') : t('modules.yourPath')}
        </Text>
        <Text variant="subhead" tone="muted">
          {state === 'locked'
            ? t('modules.scoreOptions', { title: item.title })
            : t('modules.openedOptions', { title: item.title })}
        </Text>
      </View>

      {state === 'locked' ? (
        <Callout tone="info" icon={Lock} title={t('modules.pathsLocked')}>
          {t('modules.checkGraded')}
        </Callout>
      ) : state !== 'choose' ? (
        <>
          <Callout
            tone={state === 'processing' ? 'info' : 'success'}
            icon={state === 'processing' ? Hourglass : CircleCheck}
            title={chosen ? t('modules.youChose', { position: chosen.position }) : t('modules.pathSet')}
          >
            {state === 'processing' ? t('modules.addingToModule') : t('modules.addedToModule')}
          </Callout>
          {chosen ? <OptionAssignments option={chosen} /> : null}
        </>
      ) : (
        <>
          {failure ? (
            <Callout tone="danger" title={t('modules.notChosen')}>
              {failure.kind === 'detail'
                ? t('modules.failure.detail', { detail: failure.detail })
                : t(`modules.failure.${failure.kind}`)}
            </Callout>
          ) : null}
          {path.options.map((option) => (
            <View key={option.id} className="gap-2.5">
              <Text variant="title3" accessibilityRole="header" className="px-1">
                {t('modules.option', { position: option.position })}
              </Text>
              <OptionAssignments option={option} />
              <Button
                variant="tonal"
                onPress={() => confirm(option)}
                loading={select.isPending && select.variables?.setId === option.id}
                disabled={!online || select.isPending}
                accessibilityLabel={t('modules.chooseOption', { position: option.position })}
                accessibilityHint={!online ? t('modules.offline') : undefined}
              >
                {t('modules.chooseOption', { position: option.position })}
              </Button>
            </View>
          ))}
          <Text variant="footnote" tone="muted" align="center">
            {online ? t('modules.chooseOnce') : t('modules.connectToChoose')}
          </Text>
        </>
      )}
    </>
  );
}
