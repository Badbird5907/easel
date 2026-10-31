import { useTranslation } from '@/i18n';
import { useDisplayTimeZone } from '@/lib/dates';
import { appointmentDisplay } from '@/features/appointments/display';
import { router, Stack } from 'expo-router';
import { CalendarClock } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';

import { type AppointmentGroup, useAppointmentGroups } from '@/canvas/api/appointments';
import { useDashboardCourses } from '@/canvas/api/courses';
import {
  Badge,
  Callout,
  Card,
  EmptyState,
  IconTile,
  ListGroup,
  ListItem,
  Screen,
  Skeleton,
  Text,
  useTheme,
} from '@/design';

/** Sign-up sheets from instructors (CAL-6): office hours, conferences, project check-ins. */
export default function AppointmentsScreen() {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const display = useMemo(() => appointmentDisplay(locale, zone), [locale, zone]);
  const { colors } = useTheme();
  const groups = useAppointmentGroups();
  const courses = useDashboardCourses();
  const [refreshing, setRefreshing] = useState(false);

  const courseFor = (id: string | null) => (id ? courses.data?.find((c) => c.id === id) : undefined);
  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([groups.refetch(), courses.refetch()]);
    setRefreshing(false);
  };

  const list = groups.data ?? [];
  const needed = list.filter((g) => g.requiringAction);
  const booked = list.filter((g) => !g.requiringAction && g.reserved.length > 0);
  const others = list.filter((g) => !g.requiringAction && g.reserved.length === 0);

  const row = (group: AppointmentGroup) => {
    const course = courseFor(group.courseId);
    return (
      <ListItem
        key={group.id}
        title={group.title}
        subtitle={display.summary(group, course?.code, t)}
        leading={<IconTile icon={CalendarClock} color={course?.color} tone="neutral" />}
        trailing={group.requiringAction ? <Badge tone="accent">{t('appointments.signUp')}</Badge> : undefined}
        accessibilityLabel={[
          group.title,
          display.summary(group, course?.code, t),
          group.requiringAction ? t('appointments.stillNeeded') : null,
        ]
          .filter(Boolean)
          .join(', ')}
        onPress={() => router.push({ pathname: '/appointments/[groupId]', params: { groupId: group.id } })}
      />
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: t('appointments.title') }} />
      <Screen
        contentClassName="gap-6"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        <Text variant="subhead" tone="muted" className="px-1">
          {t('appointments.intro')}
        </Text>
        {groups.isPending ? (
          <View className="gap-3">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </View>
        ) : groups.isError ? (
          <Callout
            tone="danger"
            title={t('appointments.loadError')}
            action={{ label: t('appointments.retry'), onPress: () => groups.refetch() }}
          >
            {groups.error.message}
          </Callout>
        ) : list.length === 0 ? (
          <Card variant="outlined" padding="none">
            <EmptyState
              icon={CalendarClock}
              title={t('appointments.empty')}
              description={t('appointments.emptyHint')}
            />
          </Card>
        ) : (
          <>
            {needed.length > 0 ? <ListGroup header={t('appointments.needsTime')}>{needed.map(row)}</ListGroup> : null}
            {booked.length > 0 ? <ListGroup header={t('appointments.signedUp')}>{booked.map(row)}</ListGroup> : null}
            {others.length > 0 ? (
              <ListGroup header={needed.length || booked.length ? t('appointments.more') : undefined}>
                {others.map(row)}
              </ListGroup>
            ) : null}
          </>
        )}
      </Screen>
    </>
  );
}
