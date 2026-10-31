import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { palettes } from '@/design';

import { encodeQr } from './qr';

/** The standard's quiet zone: four modules of light around the code. */
const QUIET = 4;

/**
 * A QR code as one SVG path. Always dark on light, in both color schemes:
 * plenty of scanners can't read an inverted code.
 */
export function QrCode({
  value,
  size = 220,
  accessibilityLabel,
}: {
  value: string;
  size?: number;
  accessibilityLabel: string;
}) {
  const { path, modules } = useMemo(() => {
    const qr = encodeQr(value);
    let d = '';
    for (let y = 0; y < qr.size; y++)
      for (let x = 0; x < qr.size; x++) if (qr.dark(x, y)) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
    return { path: d, modules: qr.size + QUIET * 2 };
  }, [value]);
  const light = palettes.light;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${modules} ${modules}`}>
        <Rect x={0} y={0} width={modules} height={modules} fill={light.surface} />
        <Path d={path} fill={light.fg} />
      </Svg>
    </View>
  );
}
