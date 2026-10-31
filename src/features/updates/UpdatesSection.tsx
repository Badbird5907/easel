import type * as UpdatesModule from 'expo-updates';
import { useRef, useState } from 'react';

import { ListGroup, ListItem } from '@/design';
import { useTranslation } from '@/i18n';

// Older development clients do not contain ExpoUpdates. Never evaluate the
// package there: importing its native event emitter can throw before rendering.
function loadUpdates(): typeof UpdatesModule | null {
  if (__DEV__) return null;
  try {
    // The native package must remain lazy for older installed clients.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-updates') as typeof UpdatesModule;
  } catch {
    return null;
  }
}

const updates = loadUpdates();

export function UpdatesSection() {
  const { t } = useTranslation();
  if (!updates?.isEnabled) {
    return (
      <ListGroup header={t('updates.title')} footer={t(__DEV__ ? 'updates.development' : 'updates.disabled')}>
        <ListItem title={t('updates.channel')} value={t('updates.unavailable')} />
        <ListItem title={t('updates.runtime')} value={t('updates.unavailable')} />
        <ListItem title={t('updates.current')} value={t(__DEV__ ? 'updates.developmentCurrent' : 'updates.builtIn')} />
        <ListItem title={t('updates.check')} disabled />
      </ListGroup>
    );
  }
  return <EnabledUpdates updates={updates} />;
}

function EnabledUpdates({ updates }: { updates: typeof UpdatesModule }) {
  const { t } = useTranslation();
  const state = updates.useUpdates();
  const inFlight = useRef(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<'idle' | 'latest' | 'error'>('idle');
  const busy = checking || state.isChecking || state.isDownloading;
  const check = async () => {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setResult('idle');
    try {
      const update = await updates.checkForUpdateAsync();
      if (update.isAvailable || update.isRollBackToEmbedded) {
        await updates.fetchUpdateAsync();
      } else {
        setResult('latest');
      }
    } catch {
      setResult('error');
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };
  const status = busy ? 'checking' : state.isUpdatePending ? 'pending' :
    result === 'error' || state.checkError || state.downloadError ? 'error' :
    result === 'latest' ? 'latest' : 'automatic';
  return (
    <ListGroup header={t('updates.title')} footer={t(`updates.${status}`)}>
      <ListItem title={t('updates.channel')} value={updates.channel ?? t('updates.unavailable')} />
      <ListItem title={t('updates.runtime')} value={updates.runtimeVersion ?? t('updates.unavailable')} />
      <ListItem title={t('updates.current')} value={updates.isEmbeddedLaunch ? t('updates.builtIn') : updates.updateId ?? t('updates.unavailable')} />
      <ListItem title={t('updates.check')} onPress={() => void check()} disabled={busy} />
    </ListGroup>
  );
}
