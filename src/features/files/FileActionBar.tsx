import { ExternalLink, FolderDown, Link, type LucideIcon, Printer, Share } from 'lucide-react-native';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, PressableScale, ProgressBar, Text, useTheme } from '@/design';
import { useTranslation } from '@/i18n';

import type { FileAction, FileActions } from './useFileActions';
import { downloadPresentation } from './viewerPresentation';

type Item = {
  key: FileAction;
  label: string;
  spoken: string;
  hint: string;
  icon: LucideIcon;
  onPress: () => void;
};

/** Share, Save, Open in, and Share link under a preview. */
export function FileActionBar({ actions, locked }: { actions: FileActions; locked: boolean }) {
  const { t, locale } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const items: Item[] = [
    {
      key: 'share',
      label: t('files.share'),
      spoken: t('files.share'),
      hint: t('files.viewer.hint.share'),
      icon: Share,
      onPress: actions.share,
    },
    {
      key: 'save',
      label: t('files.save'),
      spoken: t('files.save'),
      hint: t('files.viewer.hint.save'),
      icon: FolderDown,
      onPress: actions.save,
    },
    {
      key: 'open',
      label: t('files.openIn'),
      spoken: t('files.viewer.openLabel'),
      hint: t('files.viewer.hint.open'),
      icon: ExternalLink,
      onPress: actions.openIn,
    },
    ...(actions.canPrint
      ? [
          {
            key: 'print' as const,
            label: t('files.print'),
            spoken: t('files.print'),
            hint: t('files.viewer.hint.print'),
            icon: Printer,
            onPress: actions.print,
          },
        ]
      : []),
    {
      key: 'link',
      label: t('files.shareLink'),
      spoken: t('files.shareLink'),
      hint: t('files.viewer.hint.link'),
      icon: Link,
      onPress: actions.shareLink,
    },
  ];
  const downloading = actions.download.status === 'downloading' && actions.busy;
  const fraction = actions.download.progress?.fraction ?? null;

  return (
    <View className="border-t border-border bg-bg" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
      {downloading ? (
        <ProgressBar
          value={fraction ?? 0}
          size="sm"
          className="rounded-none"
          accessibilityLabel={downloadPresentation(fraction, 0, locale).label}
        />
      ) : (
        <View className="h-1" />
      )}
      <View className="flex-row px-2 pt-1">
        {items.map((item) => {
          const busy = actions.busy === item.key;
          const disabled = (locked && item.key !== 'link') || (!!actions.busy && !busy);
          return (
            <PressableScale
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={item.spoken}
              accessibilityHint={item.hint}
              accessibilityState={{ disabled, busy }}
              disabled={disabled}
              onPress={item.onPress}
              className={`min-h-[52px] flex-1 items-center justify-center gap-1 rounded-xl py-1.5 ${disabled ? 'opacity-40' : ''}`}
            >
              {busy ? (
                <ActivityIndicator color={colors.accentFg} style={{ height: 22 }} />
              ) : (
                <Icon icon={item.icon} size={22} tone="accent" />
              )}
              <Text variant="caption" tone="accent" numberOfLines={1}>
                {item.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}
