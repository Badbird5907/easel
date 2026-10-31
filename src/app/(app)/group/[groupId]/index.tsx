import { router, useLocalSearchParams } from 'expo-router';
import {
  Folder,
  LayoutList,
  LogOut,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  NotebookText,
  Users,
  UsersRound,
  Video,
} from 'lucide-react-native';
import { Alert, View } from 'react-native';
import { useTranslation } from '@/i18n';
import { membershipErrorMessage } from '@/features/groups/presentation';

import type { CourseTab } from '@/canvas/api/tabs';
import { useGroup, useGroupTabs, useLeaveGroup } from '@/canvas/api/groups';
import { Button, Card, EmptyState, IconTile, ListGroup, ListItem, Screen, Skeleton, Text, useToast } from '@/design';
import { ListSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { useContextLabel } from '@/features/groups/context';
import { GroupScope } from '@/features/groups/GroupScope';
import { openWebView } from '@/features/web/open';
import { cn } from '@/lib/cn';

const tabIcons: Record<string, LucideIcon> = {
  announcements: Megaphone,
  discussions: MessageSquare,
  pages: NotebookText,
  people: Users,
  files: Folder,
  conferences: Video,
};

/** Group tabs Easel shows natively. The rest (collaborations, tools) open on the web. */
const groupRoutes: Record<string, string> = {
  announcements: '/group/[groupId]/announcements',
  discussions: '/group/[groupId]/discussions',
  pages: '/group/[groupId]/pages',
  people: '/group/[groupId]/people',
  conferences: '/group/[groupId]/conferences',
  files: '/files/group/[groupId]',
};

function openTab(tab: CourseTab, groupId: string) {
  const pathname = (Object.prototype.hasOwnProperty.call(groupRoutes, tab.id) ? groupRoutes[tab.id] : undefined);
  if (pathname) {
    router.push({ pathname, params: { groupId } } as never);
    return;
  }
  openWebView({ url: tab.fullUrl ?? tab.htmlUrl, title: tab.label });
}

/**
 * A group's home (COURSE-7): who's in it, its tabs in Canvas order, and Leave
 * where the instructor lets students choose their own groups.
 */
export default function GroupHomeScreen() {
  const { t } = useTranslation();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const group = useGroup(groupId);
  const tabs = useGroupTabs(groupId);
  const label = useContextLabel({ type: 'group', id: groupId });
  const leave = useLeaveGroup();
  const toast = useToast();
  const refreshControl = useRefreshControl([
    ['groups', groupId],
    ['groups', groupId, 'tabs'],
  ]);

  const visible = (tabs.data ?? []).filter((t) => !t.hidden && t.id !== 'home');
  const g = group.data;
  const meta = [label.code, g ? t('groups.members', { count: g.membersCount }) : null]
    .filter(Boolean)
    .join(' · ');

  const confirmLeave = () => {
    if (!g) return;
    Alert.alert(t('groups.leaveTitle', { name: g.name }), t('groups.leaveDescription'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('groups.leave'),
        style: 'destructive',
        onPress: () =>
          leave.mutate(groupId, {
            onSuccess: () => {
              if (router.canGoBack()) router.back();
              else toast.show(t('groups.left', { name: g.name }));
            },
            onError: (error) => Alert.alert(t('groups.leaveError'), membershipErrorMessage(error, t)),
          }),
      },
    ]);
  };

  return (
    <GroupScope groupId={groupId} title={g?.name ?? t('groups.title')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        <Card padding="none">
          <View
            className={cn('gap-1 bg-accent px-4 pb-4 pt-10', g?.description ? 'rounded-t-2xl' : 'rounded-2xl')}
            style={{ borderCurve: 'continuous' }}
            accessible
            accessibilityRole="header"
            accessibilityLabel={[g?.name ?? t('groups.title'), meta].filter(Boolean).join(', ')}
          >
            <Text variant="title2" tone="onAccent">
              {g?.name ?? t('groups.title')}
            </Text>
            {group.isPending ? (
              <Skeleton className="h-4 w-1/3 opacity-60" />
            ) : meta ? (
              <Text variant="subhead" tone="onAccent">
                {meta}
              </Text>
            ) : null}
          </View>
          {g?.description ? (
            <Text variant="subhead" tone="muted" className="px-4 py-3">
              {g.description}
            </Text>
          ) : null}
        </Card>

        {group.isError ? (
          <LoadError title={t('groups.loadError')} error={group.error} onRetry={() => group.refetch()} />
        ) : null}

        {tabs.isPending ? (
          <ListSkeleton rows={5} />
        ) : tabs.isError ? (
          <LoadError title={t('groups.menuError')} error={tabs.error} onRetry={() => tabs.refetch()} />
        ) : visible.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={UsersRound}
              title={t('groups.nothing')}
              description={t('groups.nothingDescription')}
            />
          </Card>
        ) : (
          <ListGroup>
            {visible.map((tab) => (
              <ListItem
                key={tab.id}
                leading={<IconTile icon={(Object.prototype.hasOwnProperty.call(tabIcons, tab.id) ? tabIcons[tab.id] : undefined) ?? LayoutList} tone="accent" />}
                title={tab.label}
                subtitle={(Object.prototype.hasOwnProperty.call(groupRoutes, tab.id) ? groupRoutes[tab.id] : undefined) ? undefined : t('groups.opensCanvas')}
                onPress={() => openTab(tab, groupId)}
              />
            ))}
          </ListGroup>
        )}

        {g?.canLeave && !g.concluded ? (
          <Button
            variant="secondary"
            leadingIcon={LogOut}
            loading={leave.isPending}
            onPress={confirmLeave}
            className="self-start"
          >
            {t('groups.leaveGroup')}
          </Button>
        ) : null}
      </Screen>
      {toast.element}
    </GroupScope>
  );
}
