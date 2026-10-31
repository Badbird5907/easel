import { useGradePresentation } from '../presentation';
import { EyeOff, Layers } from 'lucide-react-native';
import { View } from 'react-native';

import { Badge, Card, IconTile, ProgressRing, Skeleton, Text } from '@/design';

import { displayLetter, formatPercent, spokenLetter } from '../format';
import type { GradeMode, TotalState } from '../useCourseGrades';

type Props = {
  total: TotalState;
  courseName: string;
  mode: GradeMode;
  /** Grading period title, when the course has periods. */
  periodTitle: string | null;
  /** Letters only: no ring, no percentages. */
  restricted: boolean;
};

function Message({ icon, title, body }: { icon: typeof EyeOff; title: string; body: string }) {
  return (
    <Card padding="lg" className="flex-row items-center gap-4">
      <IconTile icon={icon} tone="neutral" size="lg" />
      <View className="flex-1 gap-0.5">
        <Text variant="headline">{title}</Text>
        <Text variant="subhead" tone="muted">
          {body}
        </Text>
      </View>
    </Card>
  );
}

/** The course total: a ring with the letter grade, the percentage, and what it's based on. */
export function TotalCard({ total, courseName, mode, periodTitle, restricted }: Props) {
  const p = useGradePresentation();
  const { t, locale } = p;
  if (total.kind === 'loading') {
    return (
      <Card padding="lg" className="flex-row items-center gap-4">
        <Skeleton className="h-[72px] w-[72px] rounded-full" />
        <View className="flex-1 gap-2">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
        </View>
      </Card>
    );
  }
  if (total.kind === 'hidden') {
    return <Message icon={EyeOff} title={t('grades.hidden')} body={t('grades.hiddenHelp')} />;
  }
  if (total.kind === 'no-overall') {
    return <Message icon={Layers} title={t('grades.noOverall')} body={t('grades.noOverallHelp')} />;
  }

  const { percent, letter, actual } = total;
  const basis = [
    mode === 'current' ? t('grades.gradedOnly') : t('grades.ungradedZero'),
    periodTitle,
  ]
    .filter(Boolean)
    .join(' · ');
  const hasGrade = restricted ? letter !== null : percent !== null;
  const headline = hasGrade ? formatPercent(percent!, locale) : t('grades.noGrade');
  const spokenGrade = !hasGrade
    ? t('grades.noGrade')
    : restricted
      ? spokenLetter(letter!, p)
      : `${formatPercent(percent!, locale)}${letter ? `, ${spokenLetter(letter, p)}` : ''}`;
  const actualText =
    actual && (restricted ? actual.letter : actual.percent !== null)
      ? t('grades.actual', {
          grade: `${restricted ? displayLetter(actual.letter!, p) : formatPercent(actual.percent!, locale)}${
            !restricted && actual.letter ? ` (${displayLetter(actual.letter, p)})` : ''
          }`,
        })
      : null;

  const label = [
    t(actual ? 'grades.whatIfTotalFor' : 'grades.totalFor', {
      name: courseName,
      grade: spokenGrade,
    }),
    basis,
    actualText,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    // Card only takes a label when it's pressable; read the summary as one element.
    <View accessible accessibilityLabel={label}>
      <Card padding="lg" className="flex-row items-center gap-4">
        {restricted ? (
          <View className="h-[72px] w-[72px] items-center justify-center rounded-full bg-accent-soft">
            <Text variant="title2" tone="accent">
              {hasGrade ? displayLetter(letter!, p) : '–'}
            </Text>
          </View>
        ) : (
          <ProgressRing value={(percent ?? 0) / 100} size={72} thickness={6}>
            <Text variant={letter ? 'headline' : 'subhead'} weight="semibold" tabular>
              {letter
                ? displayLetter(letter, p)
                : percent !== null
                  ? formatPercent(Math.round(percent), locale)
                  : '–'}
            </Text>
          </ProgressRing>
        )}
        <View className="flex-1 gap-0.5">
          {restricted && hasGrade ? (
            // The letter already fills the circle; lead with the course instead of repeating it.
            <Text variant="headline" numberOfLines={2}>
              {courseName}
            </Text>
          ) : (
            <>
              <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                <Text variant={hasGrade ? 'title2' : 'headline'} tabular>
                  {headline}
                </Text>
                {actual ? (
                  <Badge tone="accent" size="sm">
                    {t('grades.whatIf')}
                  </Badge>
                ) : null}
              </View>
              <Text variant="subhead" tone="muted" numberOfLines={1}>
                {courseName}
              </Text>
            </>
          )}
          <Text variant="footnote" tone="muted">
            {hasGrade || actual ? basis : t('grades.firstGrade')}
          </Text>
          {actualText ? (
            <Text variant="footnote" tone="muted" tabular>
              {actualText}
            </Text>
          ) : null}
        </View>
      </Card>
    </View>
  );
}
