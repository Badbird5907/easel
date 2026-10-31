import { router } from 'expo-router';
import { GraduationCap } from 'lucide-react-native';

import { useGradesOverview } from '@/canvas/api/grades';
import { IconTile, ListItem } from '@/design';
import { useTranslation } from '@/i18n';

/** Only offer the shortcut when at least one course makes grades available. */
export function GradesShortcut() {
  const { t } = useTranslation();
  const grades = useGradesOverview();
  if (grades.isError || !grades.data?.length) return null;
  return (
    <ListItem
      leading={<IconTile icon={GraduationCap} tone="accent" />}
      title={t('home.grades')}
      subtitle={t('home.gradesHint')}
      onPress={() => router.push('/grades')}
    />
  );
}
