import { ClipboardCheck, FileText, FlaskConical, type LucideIcon, MessageSquare } from 'lucide-react-native';

import { Badge, type BadgeTone, IconTile, ListItem } from '@/design';
import { type Assignment, type AssignmentKind, type AssignmentStatus, courseById } from '@/mocks/canvas';

const kindIcon: Record<AssignmentKind, LucideIcon> = {
  assignment: FileText,
  quiz: ClipboardCheck,
  discussion: MessageSquare,
  lab: FlaskConical,
};

const statusBadge: Record<AssignmentStatus, { label: string; tone: BadgeTone } | null> = {
  dueToday: { label: 'Due today', tone: 'warning' },
  missing: { label: 'Missing', tone: 'danger' },
  submitted: { label: 'Submitted', tone: 'success' },
  graded: { label: 'Graded', tone: 'info' },
  upcoming: null,
};

type Props = {
  assignment: Assignment;
  /** Hide the course code when the list is already scoped to one course. */
  showCourse?: boolean;
  onPress?: () => void;
};

export function AssignmentRow({ assignment, showCourse = true, onPress }: Props) {
  const course = courseById(assignment.courseId);
  const badge = statusBadge[assignment.status];
  const meta = [showCourse ? course?.code : null, assignment.dueLabel].filter(Boolean).join(' · ');

  return (
    <ListItem
      title={assignment.title}
      subtitle={meta}
      subtitleLines={1}
      leading={<IconTile icon={kindIcon[assignment.kind]} color={course?.color} />}
      trailing={
        badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : <Badge>{`${assignment.points} pts`}</Badge>
      }
      chevron={false}
      onPress={onPress}
    />
  );
}
