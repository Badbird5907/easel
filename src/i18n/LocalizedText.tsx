import { Platform } from 'react-native';
import { Text, type TextProps } from '@/design';
import { useTranslation } from './index';

/** Pilot adapter; keeps design tokens/fonts and explicit center/end alignments intact. */
export function LocalizedText({ align, style, ...props }: TextProps) {
  const { direction } = useTranslation();
  return (
    <Text
      {...props}
      // RN resolves explicit left as logical start in RTL; do not mirror it twice.
      align={align ?? 'left'}
      style={[{ direction }, Platform.OS === 'ios' && { writingDirection: direction }, style]}
    />
  );
}
