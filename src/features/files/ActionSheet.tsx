import type { LucideIcon } from 'lucide-react-native';
import { type ReactNode, useCallback, useState } from 'react';
import { ActionSheetIOS, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, ListGroup, ListItem, Text, useTheme } from '@/design';
import { type Translate, useTranslation } from '@/i18n';

export type SheetOption = {
  key?: string;
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
};
type SheetPresentation = {
  title?: string;
  message?: string;
  options: readonly string[];
};
type SheetRequest = {
  title?: string;
  message?: string;
  options: SheetOption[];
  /** Selection keeps its deferred handoff; cancellation has no pending action. */
  onClose?: (selected: boolean) => void;
  /** Pure label factory: same option order as options. Android re-evaluates with
   * the current translator; iOS snapshots on show. Never changes callbacks,
   * icons, keys or option count. Missing presentation fields retain the originals. */
  presentation?: (t: Translate, locale: string) => SheetPresentation;
};

function present(request: SheetRequest, t: Translate, locale: string): SheetRequest {
  const labels = request.presentation?.(t, locale);
  if (!labels) return request;
  return {
    ...request,
    title: labels.title ?? request.title,
    message: labels.message ?? request.message,
    options: request.options.map((option, index) => ({
      ...option,
      label: labels.options[index] ?? option.label,
    })),
  };
}

/**
 * A short list of choices. iOS uses the system action sheet; Android gets Easel's
 * own bottom sheet (no Material), with the same options in the same order.
 */
export function useActionSheet(): {
  show: (request: SheetRequest) => void;
  sheet: ReactNode;
} {
  const { scheme } = useTheme();
  const { t, locale } = useTranslation();
  const [request, setRequest] = useState<SheetRequest | null>(null);

  const show = useCallback(
    (next: SheetRequest) => {
      if (Platform.OS === 'ios') {
        const display = present(next, t, locale);
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: display.title,
            message: display.message,
            options: [...display.options.map((o) => o.label), t('common.cancel')],
            cancelButtonIndex: next.options.length,
            userInterfaceStyle: scheme,
          },
          (index) => {
            const option = next.options[index];
            next.onClose?.(!!option);
            return option?.onPress();
          },
        );
        return;
      }
      setRequest(() => next);
    },
    [scheme, t, locale],
  );

  const choose = (option: SheetOption) => {
    request?.onClose?.(true);
    setRequest(null);
    // Let the sheet close before a system picker opens over it.
    setTimeout(option.onPress, 250);
  };

  const close = () => {
    request?.onClose?.(false);
    setRequest(null);
  };

  const sheet =
    Platform.OS === 'ios' ? null : (
      <Modal
        visible={!!request}
        transparent
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={close}
      >
        <AndroidSheet
          request={request ? present(request, t, locale) : null}
          onChoose={choose}
          onClose={close}
        />
      </Modal>
    );

  return { show, sheet };
}

function AndroidSheet({
  request,
  onChoose,
  onClose,
}: {
  request: SheetRequest | null;
  onChoose: (option: SheetOption) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { t, direction } = useTranslation();
  if (!request) return null;
  return (
    <View className="flex-1 justify-end" style={{ direction }}>
      <Pressable
        className="absolute inset-0 bg-overlay/40"
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        onPress={onClose}
      />
      <View
        className="gap-3 rounded-t-3xl bg-bg px-4 pt-4"
        style={{ paddingBottom: insets.bottom + 12, borderCurve: 'continuous' }}
      >
        {request.title ? (
          <View className="gap-0.5 px-1">
            <Text variant="headline" accessibilityRole="header">
              {request.title}
            </Text>
            {request.message ? (
              <Text variant="subhead" tone="muted">
                {request.message}
              </Text>
            ) : null}
          </View>
        ) : null}
        <ListGroup>
          {request.options.map((option) => (
            <ListItem
              key={option.key ?? option.label}
              title={option.label}
              leading={option.icon ? <Icon icon={option.icon} tone="accent" /> : undefined}
              chevron={false}
              onPress={() => onChoose(option)}
            />
          ))}
        </ListGroup>
        <Button variant="secondary" onPress={onClose}>
          {t('common.cancel')}
        </Button>
      </View>
    </View>
  );
}
