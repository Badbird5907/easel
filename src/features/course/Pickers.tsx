import { Check, ChevronDown, ChevronUp } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { Chip, Icon, ListGroup, ListItem } from '@/design';

export type Option<T extends string> = { value: T; label: string };

/**
 * A row that names the current choice and expands in place into the options.
 * For choices that change what loads, like the grading period.
 */
export function ExpandingPicker<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <ListGroup>
      <ListItem
        title={label}
        value={current?.label}
        trailing={<Icon icon={open ? ChevronUp : ChevronDown} size={18} tone="subtle" />}
        chevron={false}
        accessibilityLabel={`${label}: ${current?.label ?? ''}`}
        accessibilityHint={open ? 'Hides the options' : 'Shows the options'}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
      />
      {open
        ? options.map((option) => {
            const selected = option.value === value;
            return (
              <ListItem
                key={option.value}
                title={option.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                trailing={selected ? <Icon icon={Check} tone="accent" strokeWidth={2.25} /> : null}
                chevron={false}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              />
            );
          })
        : null}
    </ListGroup>
  );
}

/** A horizontally scrolling row of single-select chips, edge to edge. */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={accessibilityLabel}
      className="-mx-4"
      contentContainerClassName="gap-2 px-4"
    >
      {options.map((option) => (
        <Chip
          key={option.value}
          selected={option.value === value}
          accessibilityRole="radio"
          accessibilityState={{ selected: option.value === value, checked: option.value === value }}
          onPress={() => onChange(option.value)}
        >
          {option.label}
        </Chip>
      ))}
    </ScrollView>
  );
}
