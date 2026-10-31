import { useGradePresentation } from '../presentation';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';

import type { GradeAssignment } from '@/canvas/api/grades';
import { Button, Text, TextField, useTheme } from '@/design';

import { useGradeLifetime, useGradeState } from '../lifetime';
import { formatPoints } from '../format';

type Props = {
  /** The assignment being edited. Null keeps the dialog closed. */
  assignment: GradeAssignment | null;
  /** The what-if score already set for it, if any. */
  whatIf: number | undefined;
  onApply: (score: number) => void;
  onRemove: () => void;
  onClose: () => void;
  /** What-if scores are saved to Canvas (GRADE-5). */
  saving?: boolean;
  /** A parent dialog instance; locale changes do not change it. */
  lifetime?: object;
};

export function parseScore(
  text: string,
):
  | { score: number }
  | { error: 'grades.enterScore' | 'grades.invalidScore' | 'grades.negativeScore' } {
  const clean = text.trim().replace(',', '.');
  if (!clean) return { error: 'grades.enterScore' as const };
  const score = Number(clean);
  if (!Number.isFinite(score)) return { error: 'grades.invalidScore' as const };
  if (score < 0) return { error: 'grades.negativeScore' as const };
  return { score };
}

function Form({
  assignment,
  whatIf,
  onApply,
  onRemove,
  onClose,
  saving = false,
  lifetime,
}: Props & { assignment: GradeAssignment }) {
  const { t, locale } = useGradePresentation();
  const owner = useGradeLifetime(assignment.id, lifetime ?? assignment);
  const { shadows } = useTheme();
  const actual =
    assignment.submission?.hidden ||
    assignment.submission?.excused ||
    assignment.submission?.pendingReview
      ? null
      : (assignment.submission?.score ?? null);
  const [text, setText] = useGradeState(owner, () => {
    const start = whatIf ?? actual;
    return start === null ? '' : String(start);
  });
  const [error, setError] = useGradeState<
    'grades.enterScore' | 'grades.invalidScore' | 'grades.negativeScore' | null
  >(owner, () => null);
  const points = formatPoints(assignment.pointsPossible, locale);

  const revision = useGradeLifetime(text, owner, owner);
  const apply = () => {
    if (!revision.valid()) return;
    if (!owner.valid() || owner.pending.has('done')) return;
    const result = parseScore(text);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    if (owner.claim('done')) onApply(result.score);
  };

  return (
    <View
      accessibilityViewIsModal
      className="gap-4 rounded-3xl bg-surface-raised p-5"
      style={[{ borderCurve: 'continuous' }, shadows.raised ? { boxShadow: shadows.raised } : null]}
    >
      <View className="gap-1">
        <Text variant="title3" accessibilityRole="header" numberOfLines={2}>
          {assignment.name}
        </Text>
        <Text variant="subhead" tone="muted" tabular>
          {actual !== null
            ? t('grades.yourScore', { score: formatPoints(actual, locale), points })
            : t('grades.noScore', { points })}
        </Text>
      </View>
      <TextField
        label={t('grades.scoreLabel')}
        value={text}
        onChangeText={(next) => {
          if (!owner.valid() || owner.pending.has('done')) return;
          setText(next);
          if (error) setError(null);
        }}
        keyboardType="decimal-pad"
        returnKeyType="done"
        onSubmitEditing={apply}
        autoFocus
        selectTextOnFocus
        error={error ? t(error) : null}
        helperText={saving ? t('grades.savedHelp') : t('grades.unsavedHelp')}
      />
      <View className="flex-row gap-3">
        <Button
          variant="secondary"
          className="flex-1"
          onPress={() => {
            if (owner.claim('done')) onClose();
          }}
        >
          {t('grades.cancel')}
        </Button>
        <Button className="flex-1" onPress={apply}>
          {t('grades.apply')}
        </Button>
      </View>
      {whatIf !== undefined ? (
        <Button
          variant="ghost"
          onPress={() => {
            if (owner.claim('done')) onRemove();
          }}
        >
          {t('grades.useReal')}
        </Button>
      ) : null}
    </View>
  );
}

/** Small dialog for entering a hypothetical score on one assignment. */
export function WhatIfSheet(props: Props) {
  const { t } = useGradePresentation();
  const { assignment, onClose } = props;
  return (
    <Modal
      visible={assignment !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 justify-center px-5"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('grades.close')}
          onPress={onClose}
          className="absolute inset-0 bg-overlay/40"
        />
        {assignment ? <Form key={assignment.id} {...props} assignment={assignment} /> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}
