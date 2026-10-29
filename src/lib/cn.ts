import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

import { textVariants } from '@/design/tokens/typography';

/**
 * tailwind-merge needs to know our custom font sizes, otherwise it reads
 * `text-body` as a color and drops it when merged with `text-fg-muted`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: textVariants }],
    },
  },
});

/** Merge class names; later classes win over conflicting earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
