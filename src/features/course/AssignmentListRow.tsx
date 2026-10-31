import { Lock } from 'lucide-react-native';

import type { Assignment } from '@/canvas/api/assignments';
import { Badge, Icon, IconTile, ListItem, Text } from '@/design';

import { assignmentKindIcon } from './AssignmentDetails';
import {
  useAssignmentPresentation,
  useAssignmentOwner,
  type AssignmentPresentation,
} from './assignmentPresentation';
import { assignmentTarget, pushRoute } from './navigation';

/** Trailing status: what happened to the work, or nothing while it's simply open. */
function Status({ a }: { a: Assignment }) {
  const p = useAssignmentPresentation();
  const { t } = p;
  const s = a.submission;
  if (s?.excused) return <Badge tone="neutral">{t('assignmentPresentation.excused')}</Badge>;
  switch (a.status) {
    case 'missing':
      return <Badge tone="danger">{t('assignmentPresentation.missing')}</Badge>;
    case 'graded':
      return (
        <Text variant="footnote" weight="semibold" tabular>
          {p.grade(s?.score ?? null, s?.grade ?? null, a) ?? t('assignmentPresentation.graded')}
        </Text>
      );
    case 'submitted':
      return s?.late ? (
        <Badge tone="warning">{t('assignmentPresentation.late')}</Badge>
      ) : (
        <Text variant="footnote" tone="muted">
          {t('assignmentPresentation.submitted')}
        </Text>
      );
    default:
      return a.locked ? <Icon icon={Lock} size={16} tone="subtle" /> : null;
  }
}

function describe(a: Assignment, now: Date, p: AssignmentPresentation) {
  const when = a.dueAt
    ? p.t('assignmentPresentation.rowDue', { date: p.shortDate(a.dueAt, now) })
    : a.locked && a.unlockAt && a.unlockAt > now
      ? p.t('assignmentPresentation.rowOpens', {
          date: p.shortDate(a.unlockAt, now),
        })
      : p.t('assignmentPresentation.noDue');
  const points = a.gradingType === 'not_graded' || a.restricted ? null : p.points(a.points);
  return [when, points].filter(Boolean).join(' · ');
}

const spokenStatus: Record<Assignment['status'], 'notSubmitted' | 'missing' | 'submitted' | 'graded' | null> =
  {
    open: 'notSubmitted',
    missing: 'missing',
    submitted: 'submitted',
    graded: 'graded',
    none: null,
  };

/** One assignment in a course list (ASSIGN-1). */
export function AssignmentListRow({ a, now = new Date() }: { a: Assignment; now?: Date }) {
  const p = useAssignmentPresentation();
  const { t } = p;
  const target = assignmentTarget(a);
  const owner = useAssignmentOwner(JSON.stringify(target));
  const status = spokenStatus[a.status];
  const subtitle = describe(a, now, p);
  const score =
    a.status === 'graded' ? p.grade(a.submission?.score ?? null, a.submission?.grade ?? null, a) : null;
  const label = [
    a.name,
    subtitle,
    a.submission?.excused
      ? t('assignmentPresentation.excused')
      : score
        ? t('assignmentPresentation.grade', { score })
        : status
          ? t(`assignmentPresentation.${status}`)
          : null,
    a.locked ? t('assignmentPresentation.locked') : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <ListItem
      title={a.name}
      subtitle={subtitle}
      subtitleLines={1}
      leading={<IconTile icon={assignmentKindIcon[a.kind]} tone={a.locked ? 'neutral' : 'accent'} />}
      trailing={<Status a={a} />}
      accessibilityLabel={label}
      onPress={() => owner.active && pushRoute(target)}
    />
  );
}
