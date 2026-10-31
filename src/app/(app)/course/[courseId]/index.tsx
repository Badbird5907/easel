import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  BookOpen,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Folder,
  GraduationCap,
  House,
  Layers,
  LayoutList,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  NotebookText,
  Puzzle,
  ScrollText,
  Search,
  Target,
  Users,
  UsersRound,
  Video,
} from 'lucide-react-native';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from '@/i18n';

import { useCourse, useDashboardCourses } from '@/canvas/api/courses';
import { bareToolId } from '@/canvas/api/lti';
import { type CourseTab, useCourseTabs } from '@/canvas/api/tabs';
import { useCanvas } from '@/canvas/session';
import {
  Card,
  EmptyState,
  Icon,
  IconButton,
  IconTile,
  ListGroup,
  ListItem,
  Screen,
  Skeleton,
  Text,
  useTheme,
} from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import {
  asDefaultView,
  type DefaultView,
  defaultViewLabel,
  pushRoute,
  tabAction,
} from '@/features/course/navigation';
import { ListSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { predictOpenMode, useLaunchTool } from '@/features/lti/launch';
import { useToolAction } from '@/features/lti/action';
import { useToolLifetime } from '@/features/lti/lifetime';
import { useToolOpenChoice } from '@/features/lti/ToolOpenChoice';
import { openWebView } from '@/features/web/open';
import { cn } from '@/lib/cn';

const tabIcons: Record<string, LucideIcon> = {
  home: House,
  announcements: Megaphone,
  assignments: FileText,
  discussions: MessageSquare,
  grades: GraduationCap,
  people: Users,
  pages: NotebookText,
  files: Folder,
  syllabus: ScrollText,
  outcomes: Target,
  quizzes: ClipboardCheck,
  modules: Layers,
  collaborations: UsersRound,
  conferences: Video,
  search: Search,
};

const iconFor = (tab: CourseTab) =>
  tab.external ? Puzzle : Object.hasOwn(tabIcons, tab.id) ? tabIcons[tab.id] : LayoutList;

function TabRow({
  tab,
  courseId,
  defaultView,
  context,
  toolsReady = true,
}: {
  tab: CourseTab;
  courseId: string;
  defaultView: DefaultView;
  context?: { active: boolean };
  toolsReady?: boolean;
}) {
  const { account } = useCanvas();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const launchTool = useLaunchTool();
  const action = tabAction(tab, courseId, defaultView, t);
  const control = useToolAction(
    JSON.stringify([
      courseId,
      defaultView,
      tab.id,
      tab.external,
      tab.hidden,
      tab.fullUrl,
      tab.htmlUrl,
      tab.launchUrl,
    ]),
    !tab.hidden && (action.kind !== 'tool' || toolsReady),
    context,
  );
  const opening = control.pending;
  const toolId = action.kind === 'tool' ? bareToolId(tab.id) : null;
  const choice = useToolOpenChoice(toolId, tab.label, predictOpenMode(tab.label, null, account.baseUrl));
  const inBrowser = action.kind === 'tool' && choice.mode === 'browser';
  const subtitle = tab.id === 'home' ? defaultViewLabel(defaultView, t) : undefined;

  const open = () =>
    control.run((isCurrent) => {
      if (action.kind === 'route') return pushRoute(action.target);
      if (action.kind === 'web') return openWebView({ url: action.url, title: action.title, courseId });
      return launchTool(action.launch, { isCurrent });
    });

  return (
    <>
      <ListItem
        leading={<IconTile icon={iconFor(tab)} tone="accent" />}
        title={tab.label}
        subtitle={subtitle}
        subtitleLines={1}
        trailing={
          opening ? (
            <ActivityIndicator color={colors.fgMuted} />
          ) : inBrowser ? (
            <Icon icon={ExternalLink} size={18} tone="subtle" />
          ) : undefined
        }
        chevron={!inBrowser && !opening}
        disabled={opening}
        // The trailing icon shows where a tool opens; screen readers hear it instead.
        accessibilityLabel={[tab.label, subtitle, inBrowser ? t('course.browser') : null].filter(Boolean).join(', ')}
        accessibilityState={{ busy: opening }}
        accessibilityHint={toolId ? t('course.choiceHint') : undefined}
        accessibilityActions={toolId ? [{ name: 'longpress', label: t('course.choice') }] : undefined}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress') choice.choose();
        }}
        onLongPress={toolId ? choice.choose : undefined}
        onPress={open}
      />
      {toolId ? choice.sheet : null}
    </>
  );
}

/** Course home: the course's own menu, in Canvas order (COURSE-2 to COURSE-5). */
export default function CourseHomeScreen() {
  const { t, locale } = useTranslation();
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const course = useCourse(courseId);
  const tabs = useCourseTabs(courseId);
  const card = useDashboardCourses().data?.find((c) => c.id === courseId);
  const refreshControl = useRefreshControl([['courses', courseId]]);

  const name = card?.name ?? course.data?.name ?? t('course.fallback');
  const defaultView = asDefaultView(course.data?.defaultView);
  const { account, client } = useCanvas();
  const context = useToolLifetime(
    JSON.stringify([
      account.id, account.baseUrl, courseId, defaultView,
      course.isPending, course.isError, tabs.isPending, tabs.isError,
      tabs.data?.map((tab) => [tab.id, tab.hidden, tab.external, tab.fullUrl, tab.htmlUrl, tab.launchUrl]),
    ]),
    client,
  );
  const visible = tabs.data?.filter((t) => !t.hidden) ?? [];
  const code = course.data?.code ?? card?.code;
  const meta = [code && !name.startsWith(code) ? code : null, course.data?.term ?? card?.term].filter(Boolean).join(' · ');
  const teachers = course.data?.teachers ?? [];

  return (
    <CourseScope courseId={courseId} title={name}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <IconButton
              icon={Search}
              accessibilityLabel={t('course.search')}
              onPress={() => router.push({ pathname: '/course/[courseId]/search', params: { courseId } })}
            />
          ),
        }}
      />
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        <Card padding="none">
          <View
            className={cn(
              'gap-1 bg-accent p-4',
              teachers.length > 0 ? 'rounded-t-2xl' : 'rounded-2xl',
            )}
            style={{ borderCurve: 'continuous' }}
            accessible
            accessibilityRole="header"
            accessibilityLabel={[name, meta].filter(Boolean).join(', ')}
          >
            <Text variant="title3" tone="onAccent" numberOfLines={3} accessibilityLabel={name}>
              {name}
            </Text>
            {course.isPending && !card ? (
              <Skeleton className="h-4 w-1/3 opacity-60" />
            ) : meta ? (
              <Text variant="subhead" tone="onAccent">
                {meta}
              </Text>
            ) : null}
          </View>
          {teachers.length > 0 ? (
            <View className="flex-row items-center gap-2 px-4 py-3">
              <Icon icon={Users} size={16} tone="muted" />
              <Text variant="subhead" tone="muted" className="flex-1">
                {new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(teachers)}
              </Text>
            </View>
          ) : null}
        </Card>

        {course.isError && !tabs.isError ? (
          <LoadError
            title={t('course.loadError')}
            error={course.error}
            onRetry={() => course.refetch()}
          />
        ) : null}

        {tabs.isPending ? (
          <ListSkeleton rows={7} />
        ) : tabs.isError ? (
          <LoadError
            title={t('course.menuError')}
            error={tabs.error}
            onRetry={() => tabs.refetch()}
          />
        ) : visible.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={BookOpen}
              title={t('course.empty')}
              description={t('course.emptyDescription')}
            />
          </Card>
        ) : (
          <ListGroup>
            {visible.map((tab) => (
              <TabRow
                key={tab.id}
                tab={tab}
                courseId={courseId}
                defaultView={defaultView}
                context={context}
                toolsReady={!course.isPending && !course.isError}
              />
            ))}
          </ListGroup>
        )}

      </Screen>
    </CourseScope>
  );
}
