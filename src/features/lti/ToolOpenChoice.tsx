import { useState } from 'react';
import { View } from 'react-native';

import { useCanvas } from '@/canvas/session';
import { ListGroup, ListItem, SegmentedControl, Sheet, Text } from '@/design';
import { useTranslation } from '@/i18n';

import { type ToolOpenMode, useToolOpenMode } from './preferences';

/** Keep the open choice as state, not a snapshot of translated strings. */
export function useToolOpenChoice(toolId: string | null, name: string, fallback: ToolOpenMode) {
  const { account } = useCanvas();
  const { t } = useTranslation();
  const pref = useToolOpenMode(account.id, toolId, fallback);
  const [choosing, setChoosing] = useState(false);
  const select = (mode: ToolOpenMode) => {
    setChoosing(false);
    pref.setMode(mode);
  };
  const sheet = (
    <Sheet
      visible={choosing}
      title={t('tool.where', { name })}
      doneLabel={t('common.cancel')}
      onClose={() => setChoosing(false)}
    >
      <Text>{pref.mode === 'app' ? t('tool.nowApp') : t('tool.nowBrowser')}</Text>
      <ListGroup>
        <ListItem title={t('tool.openApp')} chevron={false} onPress={() => select('app')} />
        <ListItem title={t('tool.openBrowser')} chevron={false} onPress={() => select('browser')} />
      </ListGroup>
    </Sheet>
  );
  return { mode: pref.mode, setMode: pref.setMode, choose: () => setChoosing(true), sheet };
}

/** A labeled Easel / Browser switch for a tool's screen. */
export function ToolOpenModeControl({ toolId, fallback }: { toolId: string; fallback: ToolOpenMode }) {
  const { account } = useCanvas();
  const { t } = useTranslation();
  const { mode, setMode } = useToolOpenMode(account.id, toolId, fallback);
  const modes = [
    { value: 'app' as const, label: t('tool.app') },
    { value: 'browser' as const, label: t('tool.browser') },
  ];
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-3">
        <Text variant="subhead" weight="medium" tone="muted" className="flex-1">
          {t('tool.opensIn')}
        </Text>
        <SegmentedControl
          options={modes}
          value={mode}
          onChange={setMode}
          accessibilityLabel={t('tool.whereHint')}
          className="w-48"
        />
      </View>
      <Text variant="footnote" tone="muted">
        {mode === 'app' ? t('tool.appHelp') : t('tool.browserHelp')}
      </Text>
    </View>
  );
}
