import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  ClipboardCheck,
  FileText,
  Folder,
  Hourglass,
  Link2,
  Lock,
  type LucideIcon,
  MessageSquare,
  NotebookText,
  Puzzle,
  Heading1,
  Signpost,
} from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import type { CourseModule, MasteryPath, ModuleItem, ModuleItemType } from '@/canvas/api/modules';
import { Badge, Button, Icon, IconTile, ListGroup, ListItem, Text } from '@/design';
import { useTranslation } from '@/i18n';
import { useDisplayTimeZone } from '@/lib/dates';

import { createModulePresentation } from './modulePresentation';
import { moduleItemTarget, pushRoute } from './navigation';

export const moduleItemIcon: Record<ModuleItemType, LucideIcon> = {
  Assignment: FileText,
  Quiz: ClipboardCheck,
  Discussion: MessageSquare,
  Page: NotebookText,
  File: Folder,
  ExternalUrl: Link2,
  ExternalTool: Puzzle,
  SubHeader: Heading1,
};

// Full class strings so Tailwind sees them. Canvas allows indents 0 to 5.
const indentClass = ['', 'ps-8', 'ps-12', 'ps-16', 'ps-20', 'ps-24'];

/** The module's status in a few words, and why it's locked. */
export function moduleStatus(
  m: CourseModule,
  all: CourseModule[],
  now: Date,
  p: ReturnType<typeof createModulePresentation>,
) {
  const { t } = p;
  const reqs = m.items.filter((i) => i.requirement);
  const done = reqs.filter((i) => i.requirement?.completed).length;
  if (m.state === 'locked') {
    const waiting = all.filter((p) => m.prerequisiteIds.includes(p.id) && p.state !== 'completed');
    const reason =
      m.unlockAt && m.unlockAt > now
        ? t('modules.unlocks', { date: p.dateTime(m.unlockAt, now) })
        : waiting.length
          ? t('modules.prerequisites', { names: p.list(waiting.map((p) => p.name)) })
          : t('modules.instructorLock');
    return {
      badge: { label: t('modules.locked'), tone: 'neutral' as const, icon: Lock },
      line: reason,
    };
  }
  if (reqs.length > 0 && m.state === 'completed')
    return {
      badge: { label: t('modules.completed'), tone: 'success' as const, icon: CircleCheck },
      line: null,
    };
  const parts = [
    reqs.length === 0
      ? null
      : m.requirementType === 'one'
        ? t('modules.anyOne')
        : t('modules.doneCount', { done, count: reqs.length }),
    reqs.length > 0 && m.sequential ? t('modules.sequential') : null,
  ];
  return { badge: null, line: parts.filter(Boolean).join(' · ') || null };
}

function ModuleItemRow({
  item,
  courseId,
  onMarkDone,
  marking,
}: {
  item: ModuleItem;
  courseId: string;
  onMarkDone: (item: ModuleItem) => void;
  marking: boolean;
}) {
  const { t, locale } = useTranslation();
  const timeZone = useDisplayTimeZone();
  const p = createModulePresentation(locale, timeZone);
  const req = item.requirement;
  const completed = req?.completed === true;
  const canMarkDone = req?.type === 'must_mark_done' && !completed && !item.locked;
  const subtitle = [
    // The button already says "Mark done".
    req && !canMarkDone ? p.requirementLabel(req) : null,
    item.dueAt ? p.due(item.dueAt) : null,
    p.points(item.points),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListItem
      className={indentClass[Math.min(item.indent, 5)]}
      leading={
        <IconTile icon={moduleItemIcon[item.type]} tone={item.locked ? 'neutral' : 'accent'} />
      }
      title={item.title}
      subtitle={
        item.locked
          ? [t('modules.locked'), subtitle].filter(Boolean).join(' · ')
          : subtitle || undefined
      }
      subtitleLines={2}
      accessibilityLabel={[
        item.title,
        p.kind(item.type),
        item.locked ? t('modules.locked') : null,
        subtitle,
        req ? (completed ? t('modules.complete') : t('modules.incomplete')) : null,
      ]
        .filter(Boolean)
        .join(', ')}
      trailing={
        completed ? (
          <Icon icon={CircleCheck} size={22} tone="success" />
        ) : canMarkDone ? (
          <Button
            size="sm"
            variant="tonal"
            loading={marking}
            accessibilityLabel={t('modules.markNamedDone', { title: item.title })}
            onPress={() => onMarkDone(item)}
          >
            {t('modules.markDone')}
          </Button>
        ) : item.locked ? (
          <Icon icon={Lock} size={16} tone="subtle" />
        ) : null
      }
      chevron={false}
      // The row is one accessible element, so the inline button is offered as an action.
      accessibilityActions={
        canMarkDone ? [{ name: 'markDone', label: t('modules.markDone') }] : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'markDone') onMarkDone(item);
      }}
      onPress={() => pushRoute(moduleItemTarget(courseId, item))}
    />
  );
}

/**
 * Where a mastery path stands for the student (ASSIGN-15). `released` means the
 * chosen path's assignments are already in the module, so there's nothing to say.
 */
export function masteryPathState(
  path: MasteryPath,
  module: CourseModule | undefined,
): 'locked' | 'choose' | 'processing' | 'released' {
  if (path.locked) return 'locked';
  if (path.awaitingChoice && path.options.length > 1) return 'choose';
  if (path.processing) return 'processing';
  const chosen =
    path.options.find((o) => o.id === path.selectedId) ??
    (path.options.length === 1 ? path.options[0] : null);
  // Canvas assigns the path in the background; until it lands, the module doesn't list it.
  if (chosen && module && chosen.assignments.length) {
    const listed = new Set(module.items.map((i) => i.contentId));
    if (!chosen.assignments.some((a) => listed.has(a.id))) return 'processing';
  }
  return 'released';
}

/** "Choose your path" under the item whose score opens the paths, or why there's no choice yet. */
function MasteryPathRow({
  item,
  path,
  module,
  courseId,
}: {
  item: ModuleItem;
  path: MasteryPath;
  module: CourseModule;
  courseId: string;
}) {
  const { t } = useTranslation();
  const state = masteryPathState(path, module);
  if (state === 'released') return null;
  const indent = indentClass[Math.min(item.indent + 1, 5)];
  if (state === 'choose')
    return (
      <ListItem
        className={indent}
        leading={<IconTile icon={Signpost} tone="accent" />}
        title={t('modules.chooseYourPath')}
        subtitle={t('modules.scoreOpened', { title: item.title, count: path.options.length })}
        subtitleLines={2}
        accessibilityHint={t('modules.showOptions')}
        onPress={() =>
          pushRoute({
            pathname: '/course/[courseId]/module-item/[itemId]/paths',
            params: { courseId, itemId: item.id },
          })
        }
      />
    );
  return (
    <ListItem
      className={indent}
      leading={<IconTile icon={state === 'locked' ? Lock : Hourglass} tone="neutral" />}
      title={state === 'locked' ? t('modules.pathsLocked') : t('modules.addingPath')}
      subtitle={
        state === 'locked'
          ? t('modules.scoreDecides', { title: item.title })
          : t('modules.addingDescription')
      }
      subtitleLines={3}
      accessibilityLabel={
        state === 'locked'
          ? `${t('modules.pathsLocked')}. ${t('modules.scoreDecides', { title: item.title })}`
          : `${t('modules.addingPath')}. ${t('modules.addingDescription')}`
      }
    />
  );
}

type ItemGroup = { key: string; title: string | null; items: ModuleItem[] };

/** Text headers split a module's items into runs, each drawn as its own group. */
function splitAtSubHeaders(items: ModuleItem[]): ItemGroup[] {
  const groups: ItemGroup[] = [];
  let current: ItemGroup = { key: 'start', title: null, items: [] };
  for (const item of items) {
    if (item.type === 'SubHeader') {
      if (current.items.length || current.title) groups.push(current);
      current = { key: item.id, title: item.title, items: [] };
    } else {
      current.items.push(item);
    }
  }
  if (current.items.length || current.title) groups.push(current);
  return groups;
}

/** One module: a header that collapses, then its items with their requirements (CONTENT-6). */
export function ModuleSection({
  module,
  modules,
  courseId,
  expanded,
  onToggle,
  onMarkDone,
  markingId,
  masteryPaths,
}: {
  module: CourseModule;
  modules: CourseModule[];
  courseId: string;
  expanded: boolean;
  onToggle: () => void;
  onMarkDone: (item: ModuleItem) => void;
  markingId: string | null;
  /** Mastery paths by module item ID (ASSIGN-15). */
  masteryPaths?: Record<string, MasteryPath>;
}) {
  const { t, locale } = useTranslation();
  const timeZone = useDisplayTimeZone();
  const status = moduleStatus(
    module,
    modules,
    new Date(),
    createModulePresentation(locale, timeZone),
  );
  return (
    <View className="gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={[module.name, status.badge?.label, status.line]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint={expanded ? t('modules.hideItems') : t('modules.showItems')}
        onPress={onToggle}
        className="min-h-11 flex-row items-start gap-3 px-1 active:opacity-70"
      >
        <View className="flex-1 gap-1.5">
          <Text variant="title3">{module.name}</Text>
          {status.badge || status.line ? (
            <View className="flex-row flex-wrap items-center gap-2">
              {status.badge ? (
                <Badge tone={status.badge.tone} icon={status.badge.icon} size="sm">
                  {status.badge.label}
                </Badge>
              ) : null}
              {status.line ? (
                <Text variant="footnote" tone="muted">
                  {status.line}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        <View className="pt-0.5">
          <Icon icon={expanded ? ChevronUp : ChevronDown} size={20} tone="subtle" />
        </View>
      </Pressable>
      {expanded ? (
        module.items.length ? (
          splitAtSubHeaders(module.items).map((group) => (
            <View key={group.key} className="gap-2">
              {group.title ? (
                <Text
                  variant="subhead"
                  weight="semibold"
                  tone="muted"
                  accessibilityRole="header"
                  className="px-4"
                >
                  {group.title}
                </Text>
              ) : null}
              {group.items.length ? (
                <ListGroup>
                  {group.items.flatMap((item) => {
                    const row = (
                      <ModuleItemRow
                        key={item.id}
                        item={item}
                        courseId={courseId}
                        onMarkDone={onMarkDone}
                        marking={markingId === item.id}
                      />
                    );
                    const path = masteryPaths?.[item.id];
                    if (!path || masteryPathState(path, module) === 'released') return [row];
                    return [
                      row,
                      <MasteryPathRow
                        key={`${item.id}-paths`}
                        item={item}
                        path={path}
                        module={module}
                        courseId={courseId}
                      />,
                    ];
                  })}
                </ListGroup>
              ) : null}
            </View>
          ))
        ) : (
          <Text variant="subhead" tone="muted" className="px-1">
            {t('modules.emptyModule')}
          </Text>
        )
      ) : null}
    </View>
  );
}
