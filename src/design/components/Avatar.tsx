import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';

import { cn } from '@/lib/cn';

import { useReduceMotion } from '../accessibility/useReduceMotion';
import { deriveAccent } from '../theme/accent';
import { useTheme } from '../theme/ThemeProvider';
import { courseColors } from '../tokens/colors';
import type { TextVariant } from '../tokens/typography';
import { Text } from './Text';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizes: Record<Size, { box: number; text: TextVariant }> = {
  xs: { box: 24, text: 'caption' },
  sm: { box: 32, text: 'footnote' },
  md: { box: 40, text: 'callout' },
  lg: { box: 56, text: 'title3' },
  xl: { box: 72, text: 'title2' },
};

export type AvatarProps = {
  name: string;
  uri?: string | null;
  size?: Size;
  className?: string;
  /** Use when adjacent text already names this person. */
  decorative?: boolean;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** Same name, same color, every time. */
function colorFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return courseColors[Math.abs(hash) % (courseColors.length - 1)].light;
}

export function Avatar({ name, uri, size = 'md', className, decorative = false }: AvatarProps) {
  const reduceMotion = useReduceMotion();
  const { scheme } = useTheme();
  const [failed, setFailed] = useState(false);
  const spec = sizes[size];
  const fill = deriveAccent(colorFor(name), scheme);
  const showImage = !!uri && !failed;

  return (
    <View
      accessible={!decorative}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
      accessibilityRole="image"
      accessibilityLabel={name}
      className={cn('items-center justify-center overflow-hidden rounded-full', className)}
      style={{ width: spec.box, height: spec.box, backgroundColor: showImage ? undefined : fill.accentSoft }}
    >
      {showImage ? (
        <Image
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          source={{ uri }}
          style={{ width: spec.box, height: spec.box }}
          contentFit="cover"
          transition={reduceMotion ? 0 : 150}
          onError={() => setFailed(true)}
        />
      ) : null}
      {showImage ? (
        <View
          pointerEvents="none"
          className="absolute inset-0 rounded-full"
          style={{ borderWidth: 1, borderColor: scheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
        />
      ) : (
        <Text
          variant={spec.text}
          weight="semibold"
          tone="inherit"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          allowFontScaling={false}
          style={{ color: fill.accentFg }}
        >
          {initials(name)}
        </Text>
      )}
    </View>
  );
}
