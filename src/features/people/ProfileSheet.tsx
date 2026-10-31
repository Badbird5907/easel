import { router } from 'expo-router';
import { Layers, Mail } from 'lucide-react-native';
import { useRef } from 'react';
import { Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { profileRoles } from './presentation';
import { useTranslation } from '@/i18n';

import { type Person, type PersonProfile, usePersonProfile } from '@/canvas/api/people';
import { AccentScope, Avatar, Badge, Button, Callout, Icon, Skeleton, Text } from '@/design';
import { AnimatedView } from '@/design/interop';
import { useCourseColor } from '@/features/course/CourseScope';

/** Opens compose with this person filled in (CONTENT-10, INBOX-3). */
export function messagePerson(courseId: string, person: { id: string; name: string }) {
  router.push({
    pathname: '/compose',
    params: { courseId, recipientIds: person.id, recipientNames: person.name.replace(/,/g, ' ') },
  } as never);
}

type ProfileSheetProps = {
  /** The person tapped, shown right away while the full profile loads. */
  person: Person | null;
  /** Course for the profile, sections, and messages. Group rosters pass the group's course. */
  courseId: string | null;
  /** The student; their own card has no Message button. */
  userId: string;
  /** Only people the student can message get the button, e.g. not in concluded courses. */
  canMessage?: boolean;
  onClose: () => void;
};

/**
 * A person's profile card (CONTENT-10): avatar, name, pronouns, role, bio, and
 * sections, with Message. Slides up over the roster.
 */
export function ProfileSheet({ person, courseId, userId, canMessage = true, onClose }: ProfileSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const profile = usePersonProfile(courseId ?? '', courseId ? (person?.id ?? null) : null);
  // A modal renders outside the screen's accent scope, so it sets the course color again.
  const color = useCourseColor(courseId ?? '');
  // iOS can't present compose while this sheet is still leaving, so Message waits for the dismissal.
  const pending = useRef<(() => void) | null>(null);

  const message = () => {
    if (!person || !courseId) return;
    const go = () => messagePerson(courseId, person);
    onClose();
    if (Platform.OS === 'ios') pending.current = go;
    else go();
  };

  const data: PersonProfile | null = profile.data ?? null;
  const you = person?.id === userId;

  return (
    <Modal
      visible={!!person}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onDismiss={() => {
        const action = pending.current;
        pending.current = null;
        action?.();
      }}
    >
      <AccentScope color={courseId ? color : null} className="flex-1 justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          className="absolute inset-0 bg-overlay/40"
        />
        {person ? (
          <AnimatedView
            entering={SlideInDown.duration(220)}
            accessibilityViewIsModal
            className="rounded-t-3xl border-x-hairline border-t-hairline border-border bg-bg"
            style={{ maxHeight: height - insets.top - 24, borderCurve: 'continuous' }}
          >
            <View className="items-center pt-2" importantForAccessibility="no-hide-descendants">
              <View className="h-1 w-9 rounded-full bg-border-strong" />
            </View>
            <View className="min-h-12 flex-row items-center justify-end px-5 pt-1">
              <Pressable
                accessibilityRole="button"
                hitSlop={12}
                onPress={onClose}
                className="active:opacity-60"
              >
                <Text variant="body" weight="semibold" tone="accent">
                  {t('common.done')}
                </Text>
              </Pressable>
            </View>
            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerClassName="gap-5 px-5"
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            >
              <View className="items-center gap-2">
                <Avatar name={person.name} uri={data?.avatarUrl ?? person.avatarUrl} size="xl" />
                <Text variant="title2" accessibilityRole="header" align="center">
                  {person.name}
                </Text>
                {person.pronouns ? (
                  <Text variant="subhead" tone="muted">
                    {person.pronouns}
                  </Text>
                ) : null}
                <View className="flex-row flex-wrap justify-center gap-2">
                  {profileRoles(person, data, t).map((role, index) => (
                    <Badge key={index} tone="accent">
                      {role}
                    </Badge>
                  ))}
                  {you ? <Badge>{t('people.you')}</Badge> : null}
                </View>
              </View>

              {courseId && profile.isPending ? (
                <View className="gap-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </View>
              ) : profile.isError ? (
                <Callout
                  tone="danger"
                  title={t('people.profileError')}
                  action={{ label: t('common.retry'), onPress: () => profile.refetch() }}
                >
                  {profile.error.message}
                </Callout>
              ) : data ? (
                <View className="gap-4">
                  {data.title || data.pronunciation ? (
                    <View className="items-center gap-0.5">
                      {data.title ? (
                        <Text variant="callout" align="center">
                          {data.title}
                        </Text>
                      ) : null}
                      {data.pronunciation ? (
                        <Text variant="footnote" tone="muted" align="center">
                          {t('people.pronounced', { name: data.pronunciation })}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                  {data.bio ? (
                    <View className="gap-1.5">
                      <Text variant="subhead" weight="semibold" tone="muted">
                        {t('people.bio')}
                      </Text>
                      <Text variant="body" selectable>
                        {data.bio}
                      </Text>
                    </View>
                  ) : null}
                  {data.sections.length ? (
                    <View className="gap-1.5">
                      <Text variant="subhead" weight="semibold" tone="muted">
                        {t('people.sections', { count: data.sections.length })}
                      </Text>
                      {data.sections.map((name) => (
                        <View key={name} className="flex-row items-center gap-2">
                          <Icon icon={Layers} size={16} tone="muted" />
                          <Text variant="body" className="flex-1">
                            {name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {!you && canMessage && courseId ? (
                <Button leadingIcon={Mail} onPress={message} accessibilityHint={t('people.messageHint')}>
                  {t('people.message')}
                </Button>
              ) : null}
            </ScrollView>
          </AnimatedView>
        ) : null}
      </AccentScope>
    </Modal>
  );
}
