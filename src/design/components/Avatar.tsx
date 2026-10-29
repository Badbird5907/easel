import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';

import { cn } from '@/lib/cn';

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

export function Avatar({ name, uri, size = 'md', className }: AvatarProps) {
  const { scheme } = useTheme();
  const [failed, setFailed] = useState(false);
  const spec = sizes[size];
  const fill = deriveAccent(colorFor(name), scheme);
  const showImage = !!uri && !failed;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={name}
      className={cn('items-center justify-center overflow-hidden rounded-full', className)}
      style={{ width: spec.box, height: spec.box, backgroundColor: showImage ? undefined : fill.accentSoft }}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: spec.box, height: spec.box }}
          contentFit="cover"
          transition={150}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text
          variant={spec.text}
          weight="semibold"
          tone="inherit"
          allowFontScaling={false}
          style={{ color: fill.accentFg }}
        >
          {initials(name)}
        </Text>
      )}
    </View>
  );
}
