import { useGradePresentation } from '../presentation';
import { Lock } from 'lucide-react-native';
import { ScrollView } from 'react-native';

import type { GradingPeriod } from '@/canvas/api/grades';
import { Chip } from '@/design';

type Props = {
  periods: GradingPeriod[];
  /** Null means all grading periods. */
  selected: string | null;
  onSelect: (periodId: string | null) => void;
};

/**
 * Grading period choice, as a row of chips that scrolls when titles run long. A closed
 * period (its grades can't change any more) carries a lock.
 */
export function PeriodPicker({ periods, selected, onSelect }: Props) {
  const { t } = useGradePresentation();
  const options = [{ id: null, title: t('grades.allPeriods'), closed: false }, ...periods];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={t('grades.period')}
      // Bleed to the screen edges so chips scroll under the gutters.
      className="-mx-4 grow-0"
      contentContainerClassName="gap-2 px-4"
    >
      {options.map((option) => (
        <Chip
          key={option.id ?? 'all'}
          selected={option.id === selected}
          icon={option.closed ? Lock : undefined}
          accessibilityLabel={
            option.closed ? t('grades.closed', { title: option.title }) : option.title
          }
          accessibilityRole="radio"
          accessibilityState={{ checked: option.id === selected }}
          onPress={() => onSelect(option.id)}
        >
          {option.title}
        </Chip>
      ))}
    </ScrollView>
  );
}
