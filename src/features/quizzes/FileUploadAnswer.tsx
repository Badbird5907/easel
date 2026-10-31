import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Camera, FileUp, Image as ImageIcon, Paperclip, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import type { AnswerValue } from '@/canvas/api/quizzes';
import { useCanvas } from '@/canvas/session';
import type { LocalFile } from '@/canvas/uploads';
import { Button, Card, Icon, IconButton, ProgressBar, Text } from '@/design';
import { useTranslation } from '@/i18n';

import { useQuestionInputOwner } from './questionInputOwner';
import { uploadQuizFile } from './upload';

type FileAnswer = Extract<AnswerValue, { kind: 'file' }>;

/** File upload questions (QUIZ-3): pick or shoot a file, upload it, and answer with it. */
export function FileUploadAnswer({
  attemptKey,
  questionId,
  courseId,
  quizId,
  answer,
  disabled,
  onChange,
}: {
  attemptKey?: string;
  questionId?: string;
  courseId: string;
  quizId: string;
  answer: FileAnswer;
  disabled?: boolean;
  onChange: (answer: AnswerValue) => void;
}) {
  const { client } = useCanvas();
  const { t } = useTranslation();
  const owner = useQuestionInputOwner(
    JSON.stringify([courseId, quizId, attemptKey, questionId, !!disabled, answer.attachmentId]),
    { onChange, t, disabled },
  );
  const [status, setStatus] = useState<{
    owner: typeof owner;
    pending?: boolean;
    progress?: number | null;
    error?: { phase: 'pick' | 'upload'; detail: string | null };
  } | null>(null);
  const currentStatus = status?.owner === owner ? status : null;
  const uploading = currentStatus?.progress !== undefined;
  const busy = !!currentStatus?.pending;
  const error = currentStatus?.error;

  const pick = async (source: 'document' | 'camera' | 'library') => {
    const current = owner.read();
    if (!current || current.disabled) return;
    // Claim synchronously, before the first await or React state update.
    const operation = owner.claim();
    if (!operation) return;
    const invocationT = current.t;
    setStatus({ owner, pending: true });
    let phase: 'pick' | 'upload' = 'pick';
    try {
      let file: LocalFile | undefined;
      if (source === 'document') {
        const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
        if (!owner.owns(operation)) return;
        const asset = result.canceled ? null : result.assets[0];
        if (asset) file = { uri: asset.uri, name: asset.name, size: asset.size, mimeType: asset.mimeType };
      } else {
        if (source === 'camera') {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!owner.owns(operation)) return;
          if (!permission.granted) {
            Alert.alert(invocationT('quizInputs.cameraTitle'), invocationT('quizInputs.cameraHelp'));
            return;
          }
        }
        const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images', 'videos'], quality: 0.85 };
        const result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync(options)
            : await ImagePicker.launchImageLibraryAsync(options);
        if (!owner.owns(operation)) return;
        const asset = result.canceled ? null : result.assets[0];
        if (asset)
          file = {
            uri: asset.uri,
            name: asset.fileName ?? `photo-${Date.now()}.${asset.mimeType?.split('/')[1] ?? 'jpg'}`,
            size: asset.fileSize,
            mimeType: asset.mimeType,
          };
      }
      if (!file || !owner.owns(operation)) return;
      phase = 'upload';
      setStatus({ owner, pending: true, progress: 0 });
      // An entered upload cannot be rolled back here. Only UI progress/adoption is guarded.
      const uploaded = await uploadQuizFile(client, courseId, quizId, file, (progress) => {
        if (owner.owns(operation)) setStatus({ owner, pending: true, progress });
      });
      if (owner.owns(operation))
        owner.read()?.onChange({ kind: 'file', attachmentId: uploaded.id, name: uploaded.name });
    } catch (e) {
      if (owner.owns(operation)) {
        const detail =
          typeof e === 'string'
            ? e
            : e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
              ? e.message
              : null;
        setStatus({ owner, error: { phase, detail } });
      }
    } finally {
      if (owner.owns(operation)) {
        setStatus((previous) =>
          previous?.owner === owner ? { ...previous, pending: false, progress: undefined } : previous,
        );
        owner.release(operation);
      }
    }
  };

  return (
    <View className="gap-3">
      {answer.attachmentId ? (
        <Card
          className="flex-row items-center gap-3"
          accessibilityLabel={t('quizInputs.uploadedLabel', {
            name: answer.name ?? t('quizInputs.yourFile'),
          })}
        >
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-success-soft">
            <Icon icon={Paperclip} size={20} tone="success" />
          </View>
          <View className="flex-1 gap-0.5">
            <Text variant="body" weight="medium" numberOfLines={1}>
              {answer.name ?? t('quizInputs.yourFile')}
            </Text>
            <Text variant="footnote" tone="muted">
              {t('quizInputs.uploaded')}
            </Text>
          </View>
          <IconButton
            icon={X}
            accessibilityLabel={t('quizInputs.removeFile')}
            disabled={disabled || busy}
            onPress={() => {
              const current = owner.read();
              if (current && !current.disabled && !owner.busy())
                current.onChange({ kind: 'file', attachmentId: null });
            }}
          />
        </Card>
      ) : null}

      {uploading ? (
        <Card className="gap-2.5">
          <Text variant="subhead" weight="medium">
            {t('quizInputs.uploading')}
          </Text>
          <ProgressBar
            value={currentStatus?.progress ?? 0.1}
            accessibilityLabel={t('quizInputs.uploadProgress')}
          />
        </Card>
      ) : null}

      {error ? (
        <Text variant="footnote" tone="danger" accessibilityLiveRegion="polite" className="px-1">
          {t('quizInputs.fileError', {
            detail:
              error.detail ??
              t(error.phase === 'upload' ? 'quizInputs.uploadFailed' : 'quizInputs.pickFailed'),
          })}
        </Text>
      ) : null}

      <View className="gap-2">
        <Button
          variant="tonal"
          leadingIcon={FileUp}
          disabled={disabled || busy}
          onPress={() => {
            void pick('document');
          }}
        >
          {answer.attachmentId ? t('quizInputs.replaceFile') : t('quizInputs.chooseFile')}
        </Button>
        <View className="flex-row gap-2">
          <Button
            variant="secondary"
            leadingIcon={Camera}
            className="flex-1"
            disabled={disabled || busy}
            onPress={() => {
              void pick('camera');
            }}
          >
            {t('quizInputs.takePhoto')}
          </Button>
          <Button
            variant="secondary"
            leadingIcon={ImageIcon}
            className="flex-1"
            disabled={disabled || busy}
            onPress={() => {
              void pick('library');
            }}
          >
            {t('quizInputs.library')}
          </Button>
        </View>
      </View>
    </View>
  );
}
