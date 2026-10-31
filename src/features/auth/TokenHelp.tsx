import * as WebBrowser from 'expo-web-browser';
import { ExternalLink } from 'lucide-react-native';
import { useState } from 'react';

import { Button, Card, Text } from '@/design';
import { useTranslation } from '@/i18n';

import { authFormsClaim, useAuthFormsLifetime } from './authFormsLifetime';

/** How to make a personal access token in Canvas (AUTH-6). */
export function TokenHelp({ baseUrl }: { baseUrl: string | null; }) {
  const { t } = useTranslation();
  const owner = useAuthFormsLifetime(baseUrl ?? '');
  const revision = owner.revision;
  const [status, setStatus] = useState({ owner, busy: false, failed: false });
  const busy = status.owner === owner && status.busy;
  const failed = status.owner === owner && status.failed;
  const open = async () => {
    if (!baseUrl) return;
    const operation = authFormsClaim(owner, revision);
    if (!operation) return;
    setStatus({ owner, busy: true, failed: false });
    try {
      await WebBrowser.openBrowserAsync(`${baseUrl}/profile/settings`);
    } catch {
      if (operation.current()) setStatus({ owner, busy: false, failed: true });
    } finally {
      if (operation.current()) setStatus((previous) => ({ ...previous, busy: false }));
      operation.release();
    }
  };
  return (
    <Card variant="filled" className="gap-3">
      <Text variant="headline">{t('authForms.helpTitle')}</Text>
      <Text variant="subhead" tone="muted">{t('authForms.helpSteps')}</Text>
      <Text variant="subhead" tone="muted">{t('authForms.helpMissing')}</Text>
      {failed ? <Text variant="subhead" tone="danger">{t('authForms.openFailed')}</Text> : null}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        leadingIcon={ExternalLink}
        disabled={!baseUrl || busy}
        loading={busy}
        onPress={open}
      >
        {t('authForms.openSettings')}
      </Button>
    </Card>
  );
}
