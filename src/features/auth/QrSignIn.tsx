import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Linking, View } from 'react-native';

import { parseCanvasQrLogin, type CanvasQrLogin } from '@/canvas/qrLogin';
import { Button, Callout, Screen, Text, TextField } from '@/design';
import { useTranslation } from '@/i18n';

/** Mounted only while scanning; QR contents stay local and never enter navigation or storage. */
export function QrSignIn({ onScan, onClose }: { onScan: (login: CanvasQrLogin) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [invalid, setInvalid] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [paste, setPaste] = useState(false);
  const [link, setLink] = useState('');
  const claimed = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const subscription = AppState.addEventListener('change', state => {
      setActive(state === 'active');
      if (state === 'active') void getPermission().catch(() => {});
    });
    return () => { live.current = false; subscription.remove(); };
  }, [getPermission]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => subscription.remove();
  }, [onClose]);
  const read = (value: string) => {
    if (!live.current || claimed.current || AppState.currentState !== 'active') return;
    claimed.current = true;
    const login = parseCanvasQrLogin(value);
    if (!login) { setInvalid(true); return; }
    setLink('');
    onScan(login);
  };
  return (
    <Screen title={t('authQr.title')} contentClassName="gap-5">
      <Text tone="muted">{t('authQr.instructions')}</Text>
      <Text variant="footnote" tone="muted">{t('authQr.schoolHelp')}</Text>
      {invalid ? (
        <Callout tone="danger" title={t('authQr.invalidTitle')}>{t('authQr.invalid')}</Callout>
      ) : null}
      {!paste && !invalid ? (
        permission?.granted && !cameraFailed ? (
          <View className="overflow-hidden rounded-2xl bg-surface-sunken" style={{ aspectRatio: 1 }}>
            {active ? <CameraView
              style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => read(data)}
              onMountError={() => { if (live.current) setCameraFailed(true); }}
              accessibilityLabel={t('authQr.viewfinder')}
            /> : null}
          </View>
        ) : (
          <View className="gap-3">
            <Text>{t(cameraFailed ? 'authQr.cameraFailed' : 'authQr.cameraHelp')}</Text>
            {!cameraFailed ? <Button disabled={!permission} onPress={() => {
              const action = permission?.canAskAgain ? requestPermission() : Linking.openSettings();
              void action.catch(() => { if (live.current) setCameraFailed(true); });
            }}>{t(permission?.canAskAgain ? 'authQr.allowCamera' : 'authQr.openSettings')}</Button> : null}
          </View>
        )
      ) : null}
      {paste ? <View className="gap-3">
        <TextField label={t('authQr.link')} value={link} onChangeText={value => {
          setLink(value); setInvalid(false); claimed.current = false;
        }} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" />
        <Button disabled={!link.trim()} onPress={() => read(link)}>{t('authForms.signIn')}</Button>
      </View> : null}
      {invalid && !paste ? <Button onPress={() => { claimed.current = false; setInvalid(false); }}>{t('authQr.retry')}</Button> : null}
      <Button variant="secondary" onPress={() => { setPaste(!paste); setInvalid(false); claimed.current = false; setLink(''); }}>
        {t(paste ? 'authQr.scanInstead' : 'authQr.paste')}
      </Button>
      <Button variant="ghost" onPress={onClose}>{t('authQr.back')}</Button>
    </Screen>
  );
}
