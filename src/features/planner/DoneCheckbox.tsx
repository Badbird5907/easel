import { Check } from 'lucide-react-native';
import { View } from 'react-native';

import { Icon, PressableScale } from '@/design';
import { cn } from '@/lib/cn';

type Props = {
  checked: boolean;
  onToggle?: () => void;
  /** Done for reasons the student can't undo here, such as a submission. */
  locked?: boolean;
  /** The row usually carries the spoken name and a custom action; set this when the box stands alone. */
  accessibilityLabel?: string;
};

/**
 * Round check box in the current accent, so inside a course's AccentScope it
 * takes the course color. 24pt visual inside a 44pt touch target.
 */
export function DoneCheckbox({ checked, onToggle, locked = false, accessibilityLabel }: Props) {
  const box = (
    <View
      className={cn(
        'h-6 w-6 items-center justify-center rounded-full border-2',
        checked ? 'border-accent bg-accent' : 'border-accent',
        locked && 'opacity-50',
      )}
    >
      {checked ? <Icon icon={Check} size={15} tone="onAccent" strokeWidth={3} /> : null}
    </View>
  );

  if (locked || !onToggle) {
    return (
      <View
        className="h-11 w-8 items-center justify-center"
        accessible={!!accessibilityLabel}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: true }}
      >
        {box}
      </View>
    );
  }

  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      scaleTo={0.85}
      hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
      onPress={onToggle}
      className="h-11 w-8 items-center justify-center"
    >
      {box}
    </PressableScale>
  );
}
