import { useGradePresentation } from '../presentation';
import { Pressable, View } from 'react-native';

import type { GradeAssignment } from '@/canvas/api/grades';
import { kindIcon } from '@/components/AssignmentRow';
import { Badge, IconTile, ListItem, Text } from '@/design';
import { cn } from '@/lib/cn';

import type { ScoreDisplay, StatusDisplay } from '../format';

type Props = {
  assignment: GradeAssignment;
  score: ScoreDisplay;
  status: StatusDisplay | null;
  meta: string;
  /** A what-if score is replacing the real one. */
  whatIf: boolean;
  /** Set when the score can take a what-if: tapping the score opens the editor. */
  onWhatIf?: () => void;
  onPress: () => void;
};

function ScoreText({ score, whatIf }: { score: ScoreDisplay; whatIf: boolean }) {
  return (
    <View className="flex-row items-baseline">
      <Text
        variant="callout"
        weight="semibold"
        tone={whatIf ? 'accent' : score.value ? 'default' : 'subtle'}
        tabular
      >
        {score.value ?? '–'}
      </Text>
      {score.outOf ? (
        <Text variant="footnote" tone="muted" tabular>
          {` ${score.outOf}`}
        </Text>
      ) : null}
    </View>
  );
}

/** One assignment in a grade group: what it scored, its status, and a way into what-if. */
export function GradeRow({ assignment, score, status, meta, whatIf, onWhatIf, onPress }: Props) {
  const { t } = useGradePresentation();
  const showScore = score.value !== null || score.outOf !== null || score.ungraded;
  const subtitle = [meta, status?.detail].filter(Boolean).join(' · ');
  // The spoken score already covers "What-if", "Excused", and "Grade not posted yet".
  const spokenStatus =
    status && !score.spoken.toLowerCase().includes(status.label.toLowerCase())
      ? status.label
      : null;
  const label = [assignment.name, score.spoken, spokenStatus, subtitle].filter(Boolean).join('. ');

  return (
    <ListItem
      title={assignment.name}
      subtitle={subtitle}
      subtitleLines={1}
      leading={<IconTile icon={kindIcon[assignment.kind]} tone="accent" />}
      chevron={false}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityHint={t('grades.openAssignment')}
      // The score is a separate button visually; screen readers reach it as an action on the row.
      accessibilityActions={
        onWhatIf ? [{ name: 'whatif', label: t('grades.tryWhatIf') }] : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'whatif') onWhatIf?.();
      }}
      trailing={
        <View className="items-end gap-1 py-2">
          {showScore ? (
            onWhatIf ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('grades.whatIfFor', { name: assignment.name })}
                hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                onPress={onWhatIf}
                className={cn(
                  'min-h-8 justify-center rounded-full px-2.5 active:opacity-70',
                  whatIf ? 'bg-accent-soft' : 'bg-surface-sunken',
                )}
              >
                <ScoreText score={score} whatIf={whatIf} />
              </Pressable>
            ) : (
              <ScoreText score={score} whatIf={whatIf} />
            )
          ) : null}
          {status ? (
            <Badge tone={status.tone} icon={status.icon} size="sm">
              {status.label}
            </Badge>
          ) : null}
        </View>
      }
    />
  );
}
