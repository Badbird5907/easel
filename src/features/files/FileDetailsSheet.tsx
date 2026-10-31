import { X } from 'lucide-react-native';
import { Modal, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { FileItem } from '@/canvas/api/files';
import { IconButton, Screen, Text, useTheme } from '@/design';

import { useTranslation } from '@/i18n';

import { FileCard } from './FileCard';
import { useFileActions } from './useFileActions';

/** The full file card over a preview: type, size, dates, course, availability, and actions. */
export function FileDetailsSheet({
  file,
  courseId,
  canvasUrl,
  visible,
  onClose,
}: {
  file: FileItem | undefined;
  courseId?: string;
  canvasUrl?: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const actions = useFileActions(file, { canvasUrl, toastOffset: 24 });
  return (
    <Modal
      visible={visible && !!file}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <View
        className="flex-1 bg-bg"
        style={{ paddingTop: Platform.OS === 'android' ? insets.top : 0 }}
        key={scheme}
      >
        <View className="h-14 flex-row items-center justify-between px-4">
          <Text variant="headline" accessibilityRole="header">
            {t('files.viewer.details')}
          </Text>
          <IconButton
            icon={X}
            variant="secondary"
            size="sm"
            accessibilityLabel={t('files.viewer.closeDetails')}
            onPress={onClose}
          />
        </View>
        {file ? (
          <Screen>
            <FileCard file={file} courseId={courseId} actions={actions} />
          </Screen>
        ) : null}
        {actions.elements}
      </View>
    </Modal>
  );
}
