import { useIsFocused } from 'expo-router';
import { useTranslation, type Translate } from '@/i18n';
import { composeRecipientName } from './composePresentation';
import { useComposeBoundary, useComposeOwner } from './composeOwnership';
import { Check, ChevronLeft, Layers, Users, UsersRound, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, useWindowDimensions, View } from 'react-native';

import {
  type Recipient,
  type RecipientFolder,
  useRecipientContexts,
  useRecipientPeople,
} from '@/canvas/api/conversations';
import {
  Avatar,
  Callout,
  Icon,
  IconTile,
  ListGroup,
  ListItem,
  PressableScale,
  SearchField,
  Skeleton,
  Text,
} from '@/design';

/** Role names for a person's subtitle, in the order the official apps list them. */
const roleLabels = [
  'TeacherEnrollment',
  'TaEnrollment',
  'StudentEnrollment',
  'ObserverEnrollment',
  'DesignerEnrollment',
] as const;
function roleLabel(r: Recipient, t: Translate): string | undefined {
  const labels = roleLabels.filter((role) => r.roles.includes(role)).map((role) => t(`inboxCompose.${role}`));
  return labels.length ? labels.join(', ') : undefined;
}

/** Legacy one-argument callers retain their exact English output. */
export const peopleCount = (n: number, t?: Translate) =>
  t ? t('inboxCompose.peopleCount', { count: n }) : `${n} ${n === 1 ? 'person' : 'people'}`;
const folderCount = (f: RecipientFolder, t: Translate) =>
  t(f.kind === 'sections' ? 'inboxCompose.sectionsCount' : 'inboxCompose.groupsCount', { count: f.count });

/** Sections stack, groups are a small circle of people, and roles are everyone in them. */
const contextIcon = (id: string) =>
  id.startsWith('section_') ? Layers : id.startsWith('group_') ? UsersRound : Users;

/** How many people the list shows before asking for a search. */
const LIST_LIMIT = 60;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

type RecipientPickerProps = {
  courseId: string;
  courseCode: string;
  selected: Recipient[];
  onChange: (next: Recipient[]) => void;
  /** The student; never offered as a recipient. */
  userId: string;
};

/**
 * The course address book (INBOX-3): everyone in a role (Teachers, Students),
 * a section, or a student group as one recipient, or people by name. Search
 * matches people, sections, and groups.
 */
export function RecipientPicker(props: RecipientPickerProps) {
  const key = useComposeBoundary(JSON.stringify([props.courseId, props.userId]));
  return <Picker key={key} {...props} />;
}
function Picker({ courseId, courseCode, selected, onChange, userId }: RecipientPickerProps) {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState<RecipientFolder | null>(null);
  const term = useDebounced(search.trim(), 300);
  const courseContext = `course_${courseId}`;

  // Top level, or inside a folder of sections or groups, or search results.
  const contexts = useRecipientContexts(folder && !term ? folder.id : courseContext, term);
  const people = useRecipientPeople(folder && !term ? null : courseContext, term);

  const selectedIds = new Set(selected.map((r) => r.id));
  const ready =
    focused &&
    search.trim() === term &&
    !contexts.isError &&
    !people.isError &&
    !contexts.isPending &&
    !contexts.isPlaceholderData &&
    ((folder && !term) || (!people.isPending && !people.isPlaceholderData));
  const contextList = contexts.data?.contexts ?? [];
  const folders = term ? [] : (contexts.data?.folders ?? []);
  const personList = (people.data ?? []).filter((r) => r.id !== userId);
  const owner = useComposeOwner(
    JSON.stringify([courseId, userId, search.trim(), term, folder?.id, !!ready]),
    {
      selected,
      onChange,
      contextList,
      personList,
      folders,
      ready,
      contexts,
      people,
    },
    focused,
  );
  const toggle = (r: Recipient) => {
    const current = owner.read();
    if (!current?.ready) return;
    const offered = [...current.contextList, ...current.personList].find(
      (x) => x.id === r.id && x.kind === r.kind,
    );
    if (!offered) return;
    const next = current.selected.some((x) => x.id === r.id)
      ? current.selected.filter((x) => x.id !== r.id)
      : [...current.selected, offered];
    // A second tap before React renders must merge with this selection too.
    owner.publish({ ...current, selected: next });
    current.onChange(next);
  };

  // Screen readers hear how many matches a search found.
  const resultCount = contextList.length + personList.length;
  const settled = !!term && !!ready && !contexts.isFetching && !people.isFetching;
  useEffect(() => {
    if (settled)
      AccessibilityInfo.announceForAccessibility(
        resultCount === 0 ? t('inboxCompose.noMatches') : t('inboxCompose.matches', { count: resultCount }),
      );
  }, [settled, resultCount, term, t]);

  const contextRow = (r: Recipient) => {
    const checked = selectedIds.has(r.id);
    const count = r.userCount != null ? peopleCount(r.userCount, t) : undefined;
    return (
      <ListItem
        key={r.id}
        leading={<IconTile icon={contextIcon(r.id)} tone="neutral" size="sm" />}
        title={r.name}
        subtitle={count}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={[t('inboxCompose.everyone', { name: r.name }), count].filter(Boolean).join(', ')}
        trailing={checked ? <Icon icon={Check} tone="accent" strokeWidth={2.25} /> : null}
        chevron={false}
        disabled={!ready}
        onPress={() => toggle(r)}
      />
    );
  };

  const personRow = (r: Recipient) => {
    const checked = selectedIds.has(r.id);
    const role = roleLabel(r, t);
    return (
      <ListItem
        key={r.id}
        leading={<Avatar name={r.name} uri={r.avatarUrl} size="sm" />}
        title={r.name}
        subtitle={role}
        accessibilityLabel={[r.name, role].filter(Boolean).join(', ')}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        trailing={checked ? <Icon icon={Check} tone="accent" strokeWidth={2.25} /> : null}
        chevron={false}
        disabled={!ready}
        onPress={() => toggle(r)}
      />
    );
  };

  const error = contexts.error ?? people.error;
  const loading = contexts.isPending || (people.isPending && people.fetchStatus !== 'idle');

  return (
    <View className="gap-4">
      <SearchField
        value={search}
        onChangeText={(value) => {
          if (owner.read()) setSearch(value);
        }}
        placeholder={t('inboxCompose.search', { name: courseCode })}
        autoFocus
      />

      {folder && !term ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('inboxCompose.back', { name: courseCode })}
          onPress={() => {
            if (owner.read()) setFolder(null);
          }}
          className="-my-1 min-h-11 flex-row items-center gap-1 self-start pe-3 active:opacity-60"
        >
          <Icon icon={ChevronLeft} size={20} tone="accent" flipInRTL />
          <Text variant="subhead" weight="semibold" tone="accent">
            {courseCode}
          </Text>
        </PressableScale>
      ) : null}

      {error ? (
        <Callout
          tone="danger"
          title={t('inboxCompose.peopleError')}
          action={{
            label: t('inboxCompose.retry'),
            onPress: () => {
              const current = owner.read();
              if (!current) return;
              if (current.contexts.isError) void current.contexts.refetch().catch(() => {});
              if (current.people.isError) void current.people.refetch().catch(() => {});
            },
          }}
        >
          {error.message}
        </Callout>
      ) : loading ? (
        <View className="gap-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </View>
      ) : folder && !term ? (
        contextList.length > 0 ? (
          <ListGroup header={folder.name}>{contextList.map(contextRow)}</ListGroup>
        ) : (
          <Text variant="subhead" tone="muted" align="center" className="py-4">
            {t(folder.kind === 'sections' ? 'inboxCompose.noneSections' : 'inboxCompose.noneGroups', {
              name: courseCode,
            })}
          </Text>
        )
      ) : (
        <>
          {contextList.length > 0 ? (
            <ListGroup header={term ? t('inboxCompose.sectionsGroups') : t('inboxCompose.everyoneRole')}>
              {contextList.map(contextRow)}
            </ListGroup>
          ) : null}
          {folders.length > 0 ? (
            <ListGroup header={t('inboxCompose.sectionsGroups')}>
              {folders.map((f) => (
                <ListItem
                  key={f.id}
                  leading={
                    <IconTile icon={f.kind === 'sections' ? Layers : UsersRound} tone="neutral" size="sm" />
                  }
                  title={f.name}
                  subtitle={folderCount(f, t)}
                  accessibilityLabel={`${f.name}, ${folderCount(f, t)}`}
                  accessibilityHint={t(
                    f.kind === 'sections' ? 'inboxCompose.sectionsHint' : 'inboxCompose.groupsHint',
                  )}
                  disabled={!ready}
                  onPress={() => {
                    const current = owner.read();
                    const offered = current?.ready && current.folders.find((x) => x.id === f.id);
                    if (offered) setFolder(offered);
                  }}
                />
              ))}
            </ListGroup>
          ) : null}
          {personList.length === 0 ? (
            contextList.length === 0 ? (
              <Text variant="subhead" tone="muted" align="center" className="py-4">
                {term
                  ? t('inboxCompose.noneSearch', { name: courseCode, term })
                  : t('inboxCompose.nonePeople', { name: courseCode })}
              </Text>
            ) : null
          ) : (
            <ListGroup
              header={t('inboxCompose.people')}
              footer={!term && personList.length > LIST_LIMIT ? t('inboxCompose.morePeople') : undefined}
            >
              {personList.slice(0, LIST_LIMIT).map(personRow)}
            </ListGroup>
          )}
        </>
      )}
    </View>
  );
}

/** A chosen recipient: a person, or a group with its size. Tap to remove. */
export function RecipientPill({ recipient, onRemove }: { recipient: Recipient; onRemove?: () => void }) {
  const { t, locale } = useTranslation();
  const name = composeRecipientName(recipient, t);
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const isContext = recipient.kind === 'context';
  const count =
    isContext && recipient.userCount != null
      ? new Intl.NumberFormat(locale).format(recipient.userCount)
      : null;
  const content = (
    <>
      {isContext ? (
        <View className="h-6 w-6 items-center justify-center rounded-full bg-surface">
          <Icon icon={Users} size={14} tone="muted" />
        </View>
      ) : (
        <Avatar name={name} uri={recipient.avatarUrl} size="xs" decorative />
      )}
      <Text
        variant="subhead"
        weight="medium"
        numberOfLines={largeText ? undefined : 1}
        className="min-w-0 shrink"
        style={largeText ? undefined : { maxWidth: 200 }}
      >
        {name}
      </Text>
      {count ? (
        <Text variant="subhead" tone="muted" tabular>
          {count}
        </Text>
      ) : null}
      {onRemove ? <Icon icon={X} size={14} tone="muted" strokeWidth={2} /> : null}
    </>
  );
  const label = [name, isContext && recipient.userCount != null ? peopleCount(recipient.userCount, t) : null]
    .filter(Boolean)
    .join(', ');
  const className =
    'min-h-9 max-w-full flex-row items-center gap-1.5 rounded-full bg-surface-sunken py-1 pe-2.5 ps-1';
  if (!onRemove)
    return (
      <View accessible accessibilityLabel={label} className={className}>
        {content}
      </View>
    );
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('inboxCompose.remove', { name: label })}
      onPress={onRemove}
      className={`${className} active:opacity-60`}
    >
      {content}
    </PressableScale>
  );
}
