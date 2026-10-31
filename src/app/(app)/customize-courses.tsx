import { Stack } from 'expo-router';
import { BookOpen, Check, ChevronDown, ChevronUp, Star } from 'lucide-react-native';
import { useState } from 'react';
import { type AccessibilityActionEvent, Pressable, View } from 'react-native';
import { colorName, paletteLabel } from '@/features/course/presentation';
import { useTranslation } from '@/i18n';

import {
  type CourseCustomization,
  type CustomizableCourse,
  NICKNAME_MAX,
  useCustomizableCourses,
  useCustomizeCourse,
} from '@/canvas/api/courses';
import {
  AccentScope,
  Button,
  Card,
  courseColors,
  deriveAccent,
  EmptyState,
  haptics,
  Icon,
  IconButton,
  ListGroup,
  ListItem,
  PressableScale,
  Screen,
  Sheet,
  Switch,
  Text,
  TextField,
  useTheme,
  useToast,
} from '@/design';
import { ListSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { useOnline } from '@/features/offline/useOnline';
import { cn } from '@/lib/cn';

const HEX = /^#?([0-9a-f]{6})$/i;

/** The course's color as a filled dot, adjusted for contrast like every course-colored surface. */
function Swatch({ color, size = 28 }: { color: string; size?: number }) {
  return (
    <AccentScope color={color}>
      <View className="rounded-full bg-accent" style={{ width: size, height: size }} />
    </AccentScope>
  );
}

type RowProps = {
  course: CustomizableCourse;
  index: number;
  count: number;
  disabled: boolean;
  onChange: (change: CourseCustomization) => void;
  onMove: (from: number, to: number) => void;
  onEdit: () => void;
};

function CourseRow({ course, index, count, disabled, onChange, onMove, onEdit }: RowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const canMoveUp = course.onHome && index > 0;
  const canMoveDown = course.onHome && index < count - 1;
  const toggleFavorite = () => {
    haptics.selection();
    onChange({ kind: 'favorite', courseId: course.id, favorite: !course.isFavorite });
  };
  const actions = [
    ...(canMoveUp ? [{ name: 'moveUp', label: t('customize.moveUp') }] : []),
    ...(canMoveDown ? [{ name: 'moveDown', label: t('customize.moveDown') }] : []),
    { name: 'favorite', label: course.isFavorite ? t('customize.removeFavorite') : t('customize.addFavorite') },
  ];
  const onAction = (event: AccessibilityActionEvent) => {
    if (disabled) return;
    if (event.nativeEvent.actionName === 'moveUp') onMove(index, index - 1);
    if (event.nativeEvent.actionName === 'moveDown') onMove(index, index + 1);
    if (event.nativeEvent.actionName === 'favorite') toggleFavorite();
  };

  return (
    <ListItem
      leading={<Swatch color={course.color} />}
      title={course.name}
      subtitle={course.nickname ? `${course.code} · ${course.originalName}` : course.code}
      subtitleLines={1}
      accessibilityLabel={[
        course.name,
        course.code,
        course.nickname ? t('customize.nicknameFor', { name: course.originalName }) : null,
        colorName(course.color, t),
        course.isFavorite ? t('customize.favorite') : null,
        course.onHome ? t('customize.position', { position: index + 1, count }) : t('customize.notHome'),
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint={t('customize.editHint')}
      accessibilityActions={actions}
      onAccessibilityAction={onAction}
      chevron={false}
      onPress={onEdit}
      trailing={
        <View className="flex-row items-center gap-1" importantForAccessibility="no-hide-descendants">
          {course.onHome ? (
            <>
              <IconButton
                icon={ChevronUp}
                size="sm"
                accessibilityLabel={t('customize.moveNameUp', { name: course.name })}
                disabled={disabled || !canMoveUp}
                onPress={() => onMove(index, index - 1)}
              />
              <IconButton
                icon={ChevronDown}
                size="sm"
                accessibilityLabel={t('customize.moveNameDown', { name: course.name })}
                disabled={disabled || !canMoveDown}
                onPress={() => onMove(index, index + 1)}
              />
            </>
          ) : null}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={
              course.isFavorite ? t('customize.removeNameFavorite', { name: course.name }) : t('customize.addNameFavorite', { name: course.name })
            }
            accessibilityState={{ disabled, selected: course.isFavorite }}
            disabled={disabled}
            hitSlop={6}
            onPress={toggleFavorite}
            className={cn('h-8 w-8 items-center justify-center rounded-full', disabled && 'opacity-40')}
          >
            {/* Filled when starred, so the state reads at a glance and not only by color. */}
            <Star
              size={20}
              strokeWidth={1.75}
              color={course.isFavorite ? colors.warning : colors.fgSubtle}
              fill={course.isFavorite ? colors.warning : 'transparent'}
            />
          </PressableScale>
        </View>
      }
    />
  );
}

function EditCourse({
  course,
  disabled,
  onChange,
}: {
  course: CustomizableCourse;
  disabled: boolean;
  onChange: (change: CourseCustomization) => void;
}) {
  const { scheme } = useTheme();
  const { t } = useTranslation();
  const [nickname, setNickname] = useState(course.nickname ?? '');
  const [custom, setCustom] = useState(() =>
    courseColors.some((c) => c.light === course.color) ? '' : course.color,
  );
  const customMatch = custom.trim().match(HEX);
  const nicknameChanged = nickname.trim() !== (course.nickname ?? '');

  const pick = (color: string) => {
    if (color.toUpperCase() === course.color.toUpperCase()) return;
    haptics.selection();
    onChange({ kind: 'color', courseId: course.id, color });
  };

  return (
    <>
      <View className="gap-3">
        <TextField
          label={t('customize.nickname')}
          value={nickname}
          onChangeText={setNickname}
          placeholder={course.originalName}
          maxLength={NICKNAME_MAX}
          helperText={t('customize.nicknameHelp', { name: course.originalName })}
          returnKeyType="done"
          onSubmitEditing={() =>
            nicknameChanged && onChange({ kind: 'nickname', courseId: course.id, nickname })
          }
        />
        <View className="flex-row gap-2">
          <Button
            size="sm"
            disabled={disabled || !nicknameChanged}
            onPress={() => onChange({ kind: 'nickname', courseId: course.id, nickname })}
          >
            {t('customize.saveNickname')}
          </Button>
          {course.nickname ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onPress={() => {
                setNickname('');
                onChange({ kind: 'nickname', courseId: course.id, nickname: '' });
              }}
            >
              {t('customize.useCourseName')}
            </Button>
          ) : null}
        </View>
      </View>

      <View className="gap-3">
        <Text variant="overline" tone="muted" className="px-1">
          {t('customize.color')}
        </Text>
        <View
          className="flex-row flex-wrap gap-2"
          accessibilityRole="radiogroup"
          accessibilityLabel={t('customize.courseColor')}
        >
          {courseColors.map((c) => {
            const selected = c.light.toUpperCase() === course.color.toUpperCase();
            const fill = deriveAccent(c.light, scheme);
            return (
              <Pressable
                key={c.id}
                accessibilityRole="radio"
                accessibilityLabel={paletteLabel(c.id, t)}
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                onPress={() => pick(c.light)}
                className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
                style={{ backgroundColor: fill.accent }}
              >
                {selected ? <Icon icon={Check} color={fill.accentContrast} strokeWidth={2.5} /> : null}
              </Pressable>
            );
          })}
        </View>
        <View className="flex-row items-end gap-2">
          <TextField
            label={t('customize.customColor')}
            value={custom}
            onChangeText={setCustom}
            placeholder="#3A7D44"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            className="flex-1"
            error={custom.trim() && !customMatch ? t('customize.hexError') : null}
          />
          {customMatch ? <Swatch color={`#${customMatch[1]}`} size={44} /> : null}
        </View>
        <View className="flex-row">
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || !customMatch}
            onPress={() => customMatch && pick(`#${customMatch[1].toUpperCase()}`)}
          >
            {t('customize.useCustomColor')}
          </Button>
        </View>
        <Text variant="footnote" tone="muted" className="px-1">
          {t('customize.contrastHelp')}
        </Text>
      </View>

      <ListGroup footer={t('customize.favoriteHelp')}>
        <ListItem
          title={t('customize.favorite')}
          trailing={
            <Switch
              value={course.isFavorite}
              disabled={disabled}
              accessibilityLabel={t('customize.favorite')}
              onValueChange={(favorite) => onChange({ kind: 'favorite', courseId: course.id, favorite })}
            />
          }
        />
      </ListGroup>
    </>
  );
}

/** Customize Home's courses (HOME-4): order, favorites, nicknames, and colors, saved to Canvas. */
export default function CustomizeCoursesScreen() {
  const { t } = useTranslation();
  const courses = useCustomizableCourses();
  const customize = useCustomizeCourse();
  const online = useOnline();
  const toast = useToast();
  const refresh = useRefreshControl([['courses']]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const list = courses.data ?? [];
  const onHome = list.filter((c) => c.onHome);
  const others = list.filter((c) => !c.onHome);
  const editing = list.find((c) => c.id === editingId) ?? null;

  const change = (next: CourseCustomization) =>
    customize.mutate(next, {
      onError: (error) => {
        haptics.error();
        toast.show(t('customize.saveError', { error: error.message }));
      },
    });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= onHome.length) return;
    haptics.selection();
    const ids = onHome.map((c) => c.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    change({ kind: 'order', courseIds: ids });
  };

  const disabled = !online;
  const rows = (group: CustomizableCourse[]) =>
    group.map((course, index) => (
      <CourseRow
        key={course.id}
        course={course}
        index={index}
        count={group.length}
        disabled={disabled}
        onChange={change}
        onMove={move}
        onEdit={() => setEditingId(course.id)}
      />
    ));

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('customize.title') }} />
      <Screen contentClassName="gap-6" refreshControl={refresh}>
        {courses.isPending ? (
          <ListSkeleton rows={5} />
        ) : courses.isError ? (
          <LoadError
            title={t('courses.loadError')}
            error={courses.error}
            onRetry={() => courses.refetch()}
          />
        ) : list.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={BookOpen}
              title={t('customize.empty')}
              description={t('customize.emptyDescription')}
            />
          </Card>
        ) : (
          <>
            <ListGroup
              header={t('customize.onHome')}
              footer={t('customize.orderHelp')}
            >
              {rows(onHome)}
            </ListGroup>
            {others.length ? <ListGroup header={t('customize.notHome')}>{rows(others)}</ListGroup> : null}
            <Text variant="footnote" tone="muted" className="px-4">
              {t('customize.saveHelp')}
            </Text>
          </>
        )}
      </Screen>
      <Sheet visible={!!editing} title={editing?.name ?? ''} onClose={() => setEditingId(null)}>
        {editing ? (
          <EditCourse key={editing.id} course={editing} disabled={disabled} onChange={change} />
        ) : null}
      </Sheet>
      {toast.element}
    </View>
  );
}
