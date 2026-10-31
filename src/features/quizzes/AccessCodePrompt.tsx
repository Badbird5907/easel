import { KeyRound } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';

import { Button, Icon, Text, TextField, useTheme } from '@/design';
import { useTranslation } from '@/i18n';
import { useEntryOwner } from './quizEntry';

type Props = {
  visible: boolean;
  context?: unknown;
  isCurrent?: () => boolean;
  /** Set when the last code didn't work. */
  error: string | null;
  busy: boolean;
  onSubmit: (code: string) => void | Promise<void>;
  onCancel: () => void;
};

/** Asks for the quiz's access code before the attempt starts (QUIZ-5). */
export function AccessCodePrompt({ visible, context, isCurrent, error, busy, onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const { shadows } = useTheme();
  const owner = useEntryOwner(String(visible), context, { busy, isCurrent, onSubmit, onCancel });
  const [draft, setDraft] = useState<{ owner: typeof owner; code: string } | null>(null);
  const code = draft?.owner === owner ? draft.code : '';
  const content = useEntryOwner(code, owner, code);
  const ready = () => visible && owner.active && content.active &&
    !owner.current!.busy && (owner.current!.isCurrent?.() ?? true);
  const submit = async () => {
    if (!ready() || !code.trim()) return;
    const claim = owner.acquire();
    if (!claim) return;
    try { await owner.current!.onSubmit(code.trim()); }
    finally { owner.release(claim); }
  };
  const cancel = () => {
    if (!ready() || !owner.acquire()) return;
    owner.current!.onCancel();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={cancel}>
      {visible ? <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 items-center justify-center px-6"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('quizEntry.cancel')}
          onPress={cancel}
          className="absolute inset-0 bg-overlay/40"
        />
        <View
          accessibilityViewIsModal
          className="w-full max-w-[400px] gap-4 rounded-3xl bg-surface-raised p-5"
          style={[{ borderCurve: 'continuous' }, shadows.raised ? { boxShadow: shadows.raised } : null]}
        >
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
              <Icon icon={KeyRound} size={20} tone="accent" />
            </View>
            <Text variant="headline" accessibilityRole="header" className="flex-1">
              {t('quizEntry.promptTitle')}
            </Text>
          </View>
          <Text variant="subhead" tone="muted">
            {t('quizEntry.promptBody')}
          </Text>
          <TextField
            label={t('quizEntry.code')}
            value={code}
            onChangeText={(value) => { if (ready() && !owner.claim) setDraft({ owner, code: value }); }}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={submit}
            error={error}
            editable={!busy}
          />
          <View className="flex-row gap-3">
            <Button variant="secondary" className="flex-1" onPress={cancel} disabled={busy}>
              {t('quizEntry.cancel')}
            </Button>
            <Button className="flex-1" onPress={submit} loading={busy} disabled={busy || !code.trim()}>
              {t('quizEntry.start')}
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView> : null}
    </Modal>
  );
}
