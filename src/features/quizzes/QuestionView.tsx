import { Check, ChevronDown, Flag, Globe } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import type { AnswerValue, MatchingPair, QuizQuestion } from '@/canvas/api/quizzes';
import { htmlToText } from '@/canvas/html';
import { Button, Callout, Card, haptics, Icon, OptionGroup, Sheet, Text, TextField } from '@/design';
import { RichContent } from '@/features/content/RichContent';
import { RichEditor } from '@/features/editor/RichEditor';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

import { choiceText, isNumberLike } from './answers';
import { FileUploadAnswer } from './FileUploadAnswer';
import { type QuestionInputOwner, useQuestionInputOwner } from './questionInputOwner';

export type QuestionViewProps = {
  attemptKey?: string;
  question: QuizQuestion;
  answer: AnswerValue;
  flagged: boolean;
  /** Shown as "Question 3 of 12". Null for text-only items. */
  number: number | null;
  total: number;
  courseId: string;
  quizId: string;
  disabled?: boolean;
  onChange: (answer: AnswerValue) => void;
  onToggleFlag: () => void;
  /** Opens Canvas's quiz page, for question types Easel can't show. */
  onOpenWeb: () => void;
};

/** Rich markup worth a web view; plain text renders natively. */
const RICH = /<(img|math|table|sup|sub|code|pre|a|iframe|video|audio|span[^>]*class="math)|\\\(|\\\[|\$\$/i;

/** One question with the control its type needs (QUIZ-3). */
export function QuestionView({
  attemptKey,
  question: q,
  answer,
  flagged,
  number,
  total,
  courseId,
  quizId,
  disabled,
  onChange,
  onToggleFlag,
  onOpenWeb,
}: QuestionViewProps) {
  const { t, locale } = useTranslation();
  const owner = useQuestionInputOwner(
    JSON.stringify([
      courseId,
      quizId,
      attemptKey,
      q.id,
      q.type,
      !!disabled,
      q.answers.map((a) => a.id),
      q.matches.map((m) => m.id),
      q.blanks.map((b) => [b.id, b.options.map((o) => o.id)]),
    ]),
    { answer, disabled, onChange, onToggleFlag, onOpenWeb },
  );
  const pointParams = {
    value: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(q.points ?? 0),
  };
  const points =
    q.points === null
      ? null
      : t(q.points === 1 ? 'submissionFeedback.point' : 'submissionFeedback.points', pointParams);
  const heading =
    number === null ? t('quizControls.information') : t('quizInputs.heading', { number, total });
  return (
    <View className="gap-5">
      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-0.5" accessible accessibilityRole="header">
          <Text variant="headline">{heading}</Text>
          {points && number !== null ? (
            <Text variant="subhead" tone="muted" tabular>
              {points}
            </Text>
          ) : null}
        </View>
        {number !== null ? (
          <FlagButton
            flagged={flagged}
            onPress={() => {
              const current = owner.read();
              if (!current || current.disabled) return;
              haptics.selection();
              current.onToggleFlag();
            }}
            disabled={disabled}
          />
        ) : null}
      </View>

      {q.html ? <RichContent html={q.html} /> : null}
      {q.variables.length ? <Variables variables={q.variables} /> : null}

      <AnswerInput
        owner={owner}
        attemptKey={attemptKey}
        question={q}
        answer={answer}
        courseId={courseId}
        quizId={quizId}
        disabled={disabled}
        onChange={(value) => {
          const current = owner.read();
          if (current && !current.disabled) current.onChange(value);
        }}
        onOpenWeb={() => owner.read()?.onOpenWeb()}
      />
    </View>
  );
}

function FlagButton({
  flagged,
  onPress,
  disabled,
}: {
  flagged: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={flagged ? t('quizControls.flaggedReview') : t('quizInputs.flagReview')}
      accessibilityHint={flagged ? t('quizInputs.unflagHint') : t('quizInputs.flagHint')}
      accessibilityState={{ selected: flagged, disabled }}
      disabled={disabled}
      onPress={() => {
        onPress();
      }}
      hitSlop={4}
      className={cn(
        'min-h-11 flex-row items-center gap-1.5 rounded-full border px-3.5',
        flagged ? 'border-transparent bg-warning-soft' : 'border-border bg-surface',
        Platform.OS === 'ios' && 'active:opacity-60',
      )}
    >
      <Icon icon={Flag} size={16} tone={flagged ? 'warning' : 'muted'} strokeWidth={2.25} />
      <Text variant="subhead" weight="semibold" tone={flagged ? 'warning' : 'muted'}>
        {flagged ? t('quizControls.flagged') : t('quizInputs.flag')}
      </Text>
    </Pressable>
  );
}

/** Calculated questions: the values Canvas chose for this attempt, filled into the question above. */
function Variables({ variables }: { variables: { name: string; value: string }[] }) {
  const { t } = useTranslation();
  return (
    <View
      className="flex-row flex-wrap gap-2"
      accessible
      accessibilityLabel={t('quizInputs.variables', {
        values: variables.map((v) => t('quizInputs.variable', { name: v.name, value: v.value })).join(', '),
      })}
    >
      {variables.map((v) => (
        <View key={v.name} className="rounded-lg bg-surface-sunken px-3 py-1.5">
          <Text variant="callout" tabular>
            <Text variant="callout" weight="semibold">
              {v.name}
            </Text>
            {` = ${v.value}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

type InputOwner = QuestionInputOwner<
  Pick<QuestionViewProps, 'answer' | 'disabled' | 'onChange' | 'onToggleFlag' | 'onOpenWeb'>
>;

function AnswerInput({
  owner,
  attemptKey,
  question: q,
  answer,
  courseId,
  quizId,
  disabled,
  onChange,
  onOpenWeb,
}: Omit<QuestionViewProps, 'flagged' | 'number' | 'total' | 'onToggleFlag'> & { owner: InputOwner }) {
  const { t } = useTranslation();
  switch (q.type) {
    case 'multiple_choice_question':
    case 'true_false_question': {
      const selected = answer.kind === 'choice' ? answer.id : null;
      return (
        <ChoiceList
          question={q}
          isSelected={(id) => id === selected}
          multiple={false}
          disabled={disabled}
          onPress={(id) => {
            const current = owner.read();
            if (!current || current.disabled) return;
            haptics.selection();
            current.onChange({ kind: 'choice', id });
          }}
        />
      );
    }
    case 'multiple_answers_question': {
      const ids = answer.kind === 'choices' ? answer.ids : [];
      return (
        <ChoiceList
          question={q}
          isSelected={(id) => ids.includes(id)}
          multiple
          disabled={disabled}
          onPress={(id) => {
            const current = owner.read();
            if (!current || current.disabled) return;
            const latest = current.answer.kind === 'choices' ? current.answer.ids : [];
            haptics.selection();
            current.onChange({
              kind: 'choices',
              ids: latest.includes(id) ? latest.filter((x) => x !== id) : [...latest, id],
            });
          }}
        />
      );
    }
    case 'matching_question':
      return (
        <Matching
          owner={owner}
          question={q}
          pairs={answer.kind === 'matching' ? answer.pairs : []}
          disabled={disabled}
          onChange={(answerId, matchId) => {
            const current = owner.read();
            if (!current || current.disabled) return;
            const pairs = current.answer.kind === 'matching' ? current.answer.pairs : [];
            current.onChange({
              kind: 'matching',
              pairs: [...pairs.filter((p) => p.answerId !== answerId), { answerId, matchId }],
            });
          }}
        />
      );
    case 'multiple_dropdowns_question':
    case 'fill_in_multiple_blanks_question': {
      const values = answer.kind === 'blanks' ? answer.values : {};
      return (
        <Blanks
          owner={owner}
          question={q}
          values={values}
          disabled={disabled}
          onChange={(id, value) => {
            const current = owner.read();
            if (!current || current.disabled) return;
            const latest = current.answer.kind === 'blanks' ? current.answer.values : {};
            current.onChange({ kind: 'blanks', values: { ...latest, [id]: value } });
          }}
        />
      );
    }
    case 'short_answer_question':
      return (
        <TextField
          label={t('quizInputs.answer')}
          value={answer.kind === 'text' ? answer.value : ''}
          onChangeText={(value) => onChange({ kind: 'text', value })}
          editable={!disabled}
          autoCorrect={false}
          returnKeyType="done"
        />
      );
    case 'numerical_question':
    case 'calculated_question':
      return (
        <NumberAnswer
          value={answer.kind === 'text' ? answer.value : ''}
          disabled={disabled}
          onChange={(value) => onChange({ kind: 'text', value })}
        />
      );
    case 'essay_question':
      return (
        <EssayAnswer
          value={answer.kind === 'text' ? answer.value : ''}
          disabled={disabled}
          onChange={(value) => onChange({ kind: 'text', value })}
        />
      );
    case 'file_upload_question':
      return (
        <FileUploadAnswer
          attemptKey={attemptKey}
          questionId={q.id}
          courseId={courseId}
          quizId={quizId}
          answer={answer.kind === 'file' ? answer : { kind: 'file', attachmentId: null }}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case 'text_only_question':
      return null;
    case 'unsupported':
      return (
        <Callout
          tone="info"
          icon={Globe}
          title={t('quizInputs.webTitle')}
          action={{ label: t('quizInputs.webOpen'), onPress: onOpenWeb }}
        >
          {t('quizInputs.webHelp')}
        </Callout>
      );
  }
}

function ChoiceList({
  question: q,
  isSelected,
  multiple,
  disabled,
  onPress,
}: {
  question: QuizQuestion;
  isSelected: (id: string) => boolean;
  multiple: boolean;
  disabled?: boolean;
  onPress: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <View
      className="gap-2.5"
      accessibilityRole={multiple ? undefined : 'radiogroup'}
      accessibilityLabel={multiple ? t('quizInputs.chooseAll') : t('quizInputs.chooseOne')}
    >
      {multiple ? (
        <Text variant="footnote" tone="muted" className="px-1">
          {t('quizInputs.chooseAllHelp')}
        </Text>
      ) : null}
      {q.answers.map((choice) => {
        const selected = isSelected(choice.id);
        const label = choiceText(choice);
        const rich = !!choice.html && RICH.test(choice.html);
        return (
          <Pressable
            key={choice.id}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: selected, disabled }}
            accessibilityLabel={label}
            disabled={disabled}
            onPress={() => {
              onPress(choice.id);
            }}
            className={cn(
              'min-h-14 flex-row items-center gap-3 rounded-2xl border-[1.5px] px-4 py-3',
              selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface',
              Platform.OS === 'ios' && !selected && 'active:bg-surface-sunken',
            )}
            style={{ borderCurve: 'continuous' }}
          >
            <Indicator selected={selected} multiple={multiple} />
            <View className="flex-1" pointerEvents="none" importantForAccessibility="no-hide-descendants">
              {rich ? (
                <RichContent html={choice.html!} />
              ) : (
                <Text variant="body" weight={selected ? 'medium' : 'regular'}>
                  {label}
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function Indicator({ selected, multiple }: { selected: boolean; multiple: boolean }) {
  if (multiple)
    return (
      <View
        className={cn(
          'h-6 w-6 items-center justify-center rounded-md border-2',
          selected ? 'border-accent bg-accent' : 'border-border-strong bg-surface',
        )}
      >
        {selected ? <Icon icon={Check} size={16} tone="onAccent" strokeWidth={3} /> : null}
      </View>
    );
  return (
    <View
      className={cn(
        'h-6 w-6 items-center justify-center rounded-full border-2',
        selected ? 'border-accent' : 'border-border-strong bg-surface',
      )}
    >
      {selected ? <View className="h-3 w-3 rounded-full bg-accent" /> : null}
    </View>
  );
}

/** A labeled control that opens a list of choices: matching pairs and dropdown blanks. */
function PickRow({
  owner,
  label,
  value,
  placeholder,
  options,
  disabled,
  onSelect,
  onClear,
  sheetTitle,
}: {
  owner: InputOwner;
  label: string;
  value: string | null;
  placeholder: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onSelect: (value: string) => void;
  onClear?: () => void;
  sheetTitle: string;
}) {
  const { t } = useTranslation();
  const [openedBy, setOpenedBy] = useState<object | null>(null);
  const open = openedBy === owner;
  const sheet = useQuestionInputOwner(
    JSON.stringify([open, !!disabled, options.map((o) => o.value)]),
    { onSelect, onClear },
    owner,
  );
  const close = () => {
    if (sheet.read()) setOpenedBy(null);
  };
  const chosen = options.find((o) => o.value === value);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('quizInputs.selection', {
          label,
          value: chosen ? chosen.label : t('quizInputs.notChosen'),
        })}
        accessibilityHint={t('quizInputs.openChoices')}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => {
          if (sheet.read() && !disabled) setOpenedBy(owner);
        }}
        className={cn(
          'min-h-12 flex-row items-center gap-2 rounded-xl border-[1.5px] px-3.5 py-2.5',
          chosen ? 'border-accent bg-accent-soft' : 'border-border bg-surface-sunken',
          Platform.OS === 'ios' && 'active:opacity-70',
        )}
        style={{ borderCurve: 'continuous' }}
      >
        <Text
          variant="body"
          tone={chosen ? 'default' : 'subtle'}
          weight={chosen ? 'medium' : 'regular'}
          className="flex-1"
        >
          {chosen ? chosen.label : placeholder}
        </Text>
        <Icon icon={ChevronDown} size={18} tone={chosen ? 'accent' : 'subtle'} />
      </Pressable>
      <Sheet visible={open} title={sheetTitle} onClose={close}>
        <OptionGroup
          options={options}
          selected={value}
          onSelect={(v) => {
            const current = sheet.read();
            if (!current || disabled || !open || !options.some((o) => o.value === v)) return;
            current.onSelect(v);
            close();
          }}
        />
        {chosen && onClear ? (
          <Button
            variant="ghost"
            onPress={() => {
              const current = sheet.read();
              if (!current || disabled || !open) return;
              current.onClear?.();
              close();
            }}
          >
            {t('quizInputs.clear')}
          </Button>
        ) : null}
      </Sheet>
    </>
  );
}

function Matching({
  owner,
  question: q,
  pairs,
  disabled,
  onChange,
}: {
  question: QuizQuestion;
  owner: InputOwner;
  pairs: MatchingPair[];
  disabled?: boolean;
  onChange: (answerId: string, matchId: string | null) => void;
}) {
  const { t } = useTranslation();
  const options = q.matches.map((m) => ({ value: m.id, label: m.text }));
  return (
    <View className="gap-3">
      <Text variant="footnote" tone="muted" className="px-1">
        {t('quizInputs.matchHelp')}
      </Text>
      {q.answers.map((left, index) => {
        const prompt = choiceText(left);
        return (
          <Card key={left.id} className="gap-2.5">
            <Text variant="body" weight="medium">
              {prompt}
            </Text>
            <PickRow
              owner={owner}
              label={t('quizInputs.matchFor', { prompt })}
              sheetTitle={prompt.length > 40 ? t('quizInputs.item', { number: index + 1 }) : prompt}
              value={pairs.find((p) => p.answerId === left.id)?.matchId ?? null}
              placeholder={t('quizInputs.chooseMatch')}
              options={options}
              disabled={disabled}
              onSelect={(matchId) => onChange(left.id, matchId)}
              onClear={() => onChange(left.id, null)}
            />
          </Card>
        );
      })}
    </View>
  );
}

function Blanks({
  owner,
  question: q,
  values,
  disabled,
  onChange,
}: {
  question: QuizQuestion;
  owner: InputOwner;
  values: Record<string, string | null>;
  disabled?: boolean;
  onChange: (id: string, value: string | null) => void;
}) {
  const { t, locale } = useTranslation();
  const dropdowns = q.type === 'multiple_dropdowns_question';
  return (
    <View className="gap-4">
      <Text variant="footnote" tone="muted" className="px-1">
        {dropdowns ? t('quizInputs.dropdownHelp') : t('quizInputs.blankHelp')}
      </Text>
      {q.blanks.map((blank) => (
        <View key={blank.id} className="gap-1.5">
          <View className="flex-row items-center gap-2 px-1">
            <View className="h-6 min-w-6 items-center justify-center rounded-md bg-accent-soft px-1.5">
              <Text variant="caption" weight="semibold" tone="accent" tabular>
                {new Intl.NumberFormat(locale).format(blank.number)}
              </Text>
            </View>
            <Text variant="subhead" weight="medium" tone="muted">
              {t('quizInputs.blank', { number: blank.number })}
            </Text>
          </View>
          {dropdowns ? (
            <PickRow
              owner={owner}
              label={t('quizInputs.blank', { number: blank.number })}
              sheetTitle={t('quizInputs.blank', { number: blank.number })}
              value={values[blank.id] ?? null}
              placeholder={t('quizInputs.chooseAnswer')}
              options={blank.options.map((o) => ({ value: o.id, label: htmlToText(o.text) }))}
              disabled={disabled}
              onSelect={(v) => onChange(blank.id, v)}
            />
          ) : (
            <TextField
              accessibilityLabel={t('quizInputs.blank', { number: blank.number })}
              value={values[blank.id] ?? ''}
              onChangeText={(v) => onChange(blank.id, v)}
              editable={!disabled}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="done"
            />
          )}
        </View>
      ))}
    </View>
  );
}

function NumberAnswer({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const invalid = value.trim() !== '' && !isNumberLike(value);
  return (
    <TextField
      label={t('quizInputs.answer')}
      value={value}
      onChangeText={onChange}
      editable={!disabled}
      // iOS's decimal pad has no minus sign.
      keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
      autoCorrect={false}
      returnKeyType="done"
      error={invalid ? t('quizInputs.invalidNumber') : null}
      helperText={t('quizInputs.numberHelp')}
    />
  );
}

function EssayAnswer({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const words = htmlToText(value).split(/\s+/).filter(Boolean).length;
  return (
    <View className="gap-1.5">
      <RichEditor
        label={t('quizInputs.answer')}
        value={value}
        onChange={onChange}
        placeholder={t('quizInputs.writeAnswer')}
        minHeight={200}
        editable={!disabled}
      />
      <Text variant="footnote" tone="muted" className="px-1" tabular>
        {t('quizInputs.words', { count: words })}
      </Text>
    </View>
  );
}
