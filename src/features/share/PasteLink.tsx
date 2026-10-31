import { useIsFocused, useNavigation } from 'expo-router';
import { ClipboardPaste } from 'lucide-react-native';
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { useCanvas } from '@/canvas/session';
import { Button, Callout, TextField } from '@/design';
import { useTranslation } from '@/i18n';

import { SharePasteOwner, sharePasteNoticeBody } from './sharePasteLifetime';

/** Paste a Canvas address into Easel (SYS-3), preserving the link payload. */
export function PasteLink() {
  const { account, client } = useCanvas();
  const { t } = useTranslation();
  const focused = useIsFocused();
  const navigation = useNavigation();
  const { id, baseUrl, host } = account;
  const userId = account.user.id;
  const owner = useMemo(
    () => new SharePasteOwner({ ...account, user: { ...account.user } }, focused, navigation),
    // Scalar identity changes also catch in-place session replacements. Locale
    // and equivalent account clones do not retire valid input or pending work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, userId, baseUrl, host, client, focused, navigation],
  );
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.retire();
  }, [owner]);
  useLayoutEffect(() => owner.setTranslator(t), [owner, t]);
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const { value, error, notice } = state;

  return (
    <View className="gap-3">
      <TextField
        label={t('sharePaste.label')}
        placeholder={t('sharePaste.placeholder', { host })}
        value={value}
        onChangeText={(v) => owner.edit(state, v)}
        error={error ? t(`sharePaste.${error}`) : null}
        helperText={t('sharePaste.helper')}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="URL"
        returnKeyType="go"
        onSubmitEditing={() => owner.open(state)}
        clearable
      />
      <View className="flex-row gap-3">
        <Button
          variant="secondary"
          leadingIcon={ClipboardPaste}
          className="flex-1"
          onPress={() => owner.paste(state)}
        >
          {t('sharePaste.paste')}
        </Button>
        <Button className="flex-1" onPress={() => owner.open(state)} disabled={!value.trim()}>
          {t('sharePaste.open')}
        </Button>
      </View>
      {notice ? (
        <Callout
          tone="warning"
          title={t('sharePaste.otherTitle')}
          action={{ label: t('sharePaste.browser'), onPress: () => owner.browse(state) }}
        >
          {sharePasteNoticeBody(notice.host, host, t)}
        </Callout>
      ) : null}
    </View>
  );
}
