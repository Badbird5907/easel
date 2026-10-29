import { View } from 'react-native';

import { cn } from '@/lib/cn';

export type DividerProps = {
  /** Left inset in px, to align with text in a row. */
  inset?: number;
  className?: string;
};

export function Divider({ inset = 0, className }: DividerProps) {
  return (
    <View
      className={cn('h-hairline bg-border', className)}
      style={inset ? { marginLeft: inset } : undefined}
    />
  );
}
