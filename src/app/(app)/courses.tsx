import { Stack } from 'expo-router';
import { BookOpen, Plus, Star, UserPlus } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';

import { useDashboardCourses } from '@/canvas/api/courses';
import { type EnrolledCourse, useEnrolledCourses, useJoinCourse } from '@/canvas/api/enrollments';
import {
  Button,
  Card,
  EmptyState,
  haptics,
  Icon,
  IconButton,
  IconTile,
  ListGroup,
  ListItem,
  Screen,
  SearchField,
  Section,
  Text,
  TextField,
  useTheme,
} from '@/design';
import { pushRoute } from '@/features/course/navigation';
import { ListSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { CourseInvitations } from '@/features/home/CourseInvitations';

import { createDateContext, useDisplayTimeZone } from '@/lib/dates';
import { byName, fold, matches, pastByTerm, subtitleFor } from '@/features/course/presentation';
import { joinErrorMessage } from '@/features/course/joinPresentation';

function CourseRow({ course, color, now }: { course: EnrolledCourse; color: string; now: Date }) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const dates = createDateContext(locale, zone);
  const subtitle = subtitleFor(course, now, t, dates);
  return (
    <ListItem
      leading={<IconTile icon={BookOpen} color={color} />}
      title={course.name}
      subtitle={subtitle || undefined}
      subtitleLines={1}
      trailing={course.isFavorite ? <Icon icon={Star} size={16} tone="subtle" /> : undefined}
      accessibilityLabel={[course.name, subtitle, course.isFavorite ? t('courses.dashboard') : null]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint={t('courses.openHint')}
      onPress={() => pushRoute({ pathname: '/course/[courseId]', params: { courseId: course.id } })}
    />
  );
}

/**
 * Join a course with the code or link an instructor shared (COURSE-8). A panel
 * that rides above the keyboard, since it's a single field to type in.
 */
function JoinCourseSheet({
  visible,
  onClose,
  onJoined,
}: {
  visible: boolean;
  onClose: () => void;
  onJoined: (courseId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { t, direction } = useTranslation();
  const join = useJoinCourse();
  const [input, setInput] = useState('');
  // iOS can't push the course while this panel is still leaving, so it waits for the dismissal.
  const joined = useRef<string | null>(null);

  const close = () => {
    if (join.isPending) return;
    onClose();
  };

  const submit = () => {
    if (!input.trim() || join.isPending) return;
    join.mutate(input, {
      onSuccess: (courseId) => {
        haptics.success();
        setInput('');
        if (Platform.OS === 'ios') joined.current = courseId;
        onClose();
        if (Platform.OS !== 'ios') onJoined(courseId);
      },
      onError: () => haptics.error(),
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
      onShow={() => {
        join.reset();
        setInput('');
      }}
      onDismiss={() => {
        const id = joined.current;
        joined.current = null;
        if (id) onJoined(id);
      }}
    >
      <KeyboardAvoidingView style={{ direction }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={close}
          className="absolute inset-0 bg-overlay/40"
        />
        <View
          accessibilityViewIsModal
          className="gap-4 rounded-t-3xl border-x-hairline border-t-hairline border-border bg-bg px-4 pt-4"
          style={{ paddingBottom: Math.max(insets.bottom, 16), borderCurve: 'continuous' }}
        >
          <View className="min-h-11 flex-row items-center gap-3 px-1">
            <Text variant="headline" accessibilityRole="header" className="flex-1">
              {t('courses.join')}
            </Text>
            <Pressable accessibilityRole="button" hitSlop={12} onPress={close} className="active:opacity-60">
              <Text variant="body" weight="semibold" tone="accent">
                {t('common.cancel')}
              </Text>
            </Pressable>
          </View>
          <TextField
            label={t('courses.joinCode')}
            placeholder="ABC123"
            value={input}
            onChangeText={(value) => {
              setInput(value);
              if (join.error) join.reset();
            }}
            error={join.error ? joinErrorMessage(join.error, t) : null}
            helperText={t('courses.joinHelp')}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={submit}
            editable={!join.isPending}
          />
          <Button onPress={submit} disabled={!input.trim()} loading={join.isPending}>
            {t('courses.joinSubmit')}
          </Button>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Every course the student is in, was in, or will be in (COURSE-1): current,
 * upcoming, then past by term, with search across all of them. Pending
 * invitations sit on top. Never shows grades (HOME-3).
 */
export default function AllCoursesScreen() {
  const { t } = useTranslation();
  const enrolled = useEnrolledCourses();
  const dashboard = useDashboardCourses();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [joining, setJoining] = useState(false);
  const openCourse = (courseId: string) =>
    pushRoute({ pathname: '/course/[courseId]', params: { courseId } });
  // Opening the course is the confirmation; it's now in the lists too.
  const onJoined = openCourse;
  const refreshControl = useRefreshControl([
    ['courses', 'enrolled'],
    ['courses', 'dashboard'],
    ['enrollments', 'invitations'],
  ]);
  const now = new Date();

  const all = enrolled.data?.courses ?? [];
  const term = fold(query.trim());
  const shown = term ? all.filter((c) => matches(c, term)) : all;
  const current = shown.filter((c) => c.timing === 'current').sort(byName);
  const future = shown.filter((c) => c.timing === 'future').sort(byName);
  const past = pastByTerm(shown.filter((c) => c.timing === 'past'));
  const restricted = enrolled.data?.restrictedCount ?? 0;
  // The dashboard's colors are the source of truth for courses on it.
  const colorFor = (c: EnrolledCourse) => dashboard.data?.find((d) => d.id === c.id)?.color ?? c.color;

  const list = (courses: EnrolledCourse[]) => (
    <ListGroup>
      {courses.map((c) => (
        <CourseRow key={c.id} course={c} color={colorFor(c)} now={now} />
      ))}
    </ListGroup>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: t('courses.all'),
          headerRight: () => (
            <IconButton
              icon={Plus}
              accessibilityLabel={t('courses.join')}
              iconColor={colors.accentFg}
              onPress={() => setJoining(true)}
            />
          ),
        }}
      />
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        {term ? null : <CourseInvitations />}

        {enrolled.isPending ? (
          <ListSkeleton rows={6} />
        ) : enrolled.isError && !enrolled.data ? (
          <LoadError
            title={t('courses.loadError')}
            error={enrolled.error}
            onRetry={() => enrolled.refetch()}
          />
        ) : all.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={BookOpen}
              title={t('courses.empty')}
              description={t('courses.emptyDescription')}
              action={{ label: t('courses.join'), leadingIcon: UserPlus, onPress: () => setJoining(true) }}
            />
          </Card>
        ) : (
          <>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder={t('courses.search')}
              accessibilityHint={t('courses.searchHint')}
            />

            {shown.length === 0 ? (
              <Text
                variant="subhead"
                tone="muted"
                align="center"
                className="py-8"
                accessibilityLiveRegion="polite"
              >
                {t('courses.noMatches', { query: query.trim() })}
              </Text>
            ) : (
              <>
                {current.length > 0 ? <Section title={t('courses.current')}>{list(current)}</Section> : null}
                {future.length > 0 ? <Section title={t('courses.upcoming')}>{list(future)}</Section> : null}
                {past.length > 0 ? (
                  <Section title={t('courses.past')}>
                    <View className="gap-5">
                      {past.map((group) => (
                        <ListGroup key={group.key} header={group.title ?? t('courses.otherPast')}>
                          {group.courses.map((c) => (
                            <CourseRow key={c.id} course={c} color={colorFor(c)} now={now} />
                          ))}
                        </ListGroup>
                      ))}
                    </View>
                  </Section>
                ) : null}
              </>
            )}

            {!term ? (
              <ListGroup footer={t('courses.joinFooter')}>
                <ListItem
                  leading={<IconTile icon={UserPlus} tone="accent" />}
                  title={t('courses.join')}
                  onPress={() => setJoining(true)}
                />
              </ListGroup>
            ) : null}

            {restricted > 0 && !term ? (
              <Text variant="footnote" tone="muted" className="px-4">
                {t('courses.restricted', { count: restricted })}
              </Text>
            ) : null}
          </>
        )}
      </Screen>
      <JoinCourseSheet visible={joining} onClose={() => setJoining(false)} onJoined={onJoined} />
    </>
  );
}
