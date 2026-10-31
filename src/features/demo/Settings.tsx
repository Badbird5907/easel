import { Alert } from 'react-native';
import { router } from 'expo-router';
import { ListItem, useToast } from '@/design';
import { useTranslation } from '@/i18n';

export function DemoSettings({
  active,
  start,
  exit,
}: {
  active: boolean;
  start: () => Promise<void>;
  exit: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      router.replace('/');
    } catch {
      toast.show(t('demo.failed'));
    }
  };
  const confirm = (reset: boolean) =>
    Alert.alert(t(reset ? 'demo.reset' : 'demo.exit'), t(reset ? 'demo.resetBody' : 'demo.exitBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t(reset ? 'demo.reset' : 'demo.exit'),
        style: 'destructive',
        onPress: () => void run(reset ? start : exit),
      },
    ]);
  return active ? (
    <>
      <ListItem title={t('demo.reset')} subtitle={t('demo.label')} onPress={() => confirm(true)} />
      <ListItem title={t('demo.exit')} onPress={() => confirm(false)} />
    </>
  ) : (
    <ListItem title={t('demo.start')} subtitle={t('demo.hint')} onPress={() => void run(start)} />
  );
}
