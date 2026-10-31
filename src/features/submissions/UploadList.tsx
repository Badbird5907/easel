import { useLayoutEffect, useMemo, useRef } from 'react';
import { CircleCheck, RotateCw, X } from 'lucide-react-native';
import { useWindowDimensions, View } from 'react-native';

import { useCanvas } from '@/canvas/session';
import { Card, Divider, Icon, IconButton, ProgressBar, Text } from '@/design';
import { FileThumbnail } from '@/features/files/FileThumbnail';
import { useTranslation } from '@/i18n';

import { uploadStatusText } from './uploadPresentation';
import { removeUpload, retryUpload, uploadsFor, type UploadItem } from './uploadStore';

/**
 * Files on their way to Canvas: per-file progress, retry, and remove (ASSIGN-4).
 * Reads from the upload store, so it shows uploads that started on an earlier visit.
 */
export function UploadList({
  slot,
  items,
  disabled,
  className,
}: {
  slot: string;
  items: UploadItem[];
  disabled?: boolean;
  className?: string;
}) {
  const { account, client } = useCanvas();
  const { t, locale } = useTranslation();
  const context = useMemo(
    () => ({ accountId: account.id, client, slot }),
    [account.id, client, slot],
  );
  const committed = useRef<{
    context: typeof context;
    items: UploadItem[];
    disabled?: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    committed.current = { context, items, disabled };
    return () => {
      committed.current = null;
    };
  }, [context, items, disabled]);
  const eligible = (id: string, retry: boolean) => {
    const latest = committed.current;
    if (!latest || latest.context !== context || latest.disabled) return false;
    const shown = latest.items.find((item) => item.id === id);
    const current = uploadsFor(slot).find((item) => item.id === id);
    return (
      !!shown && !!current && (!retry || (shown.status === 'error' && current.status === 'error'))
    );
  };
  const { fontScale } = useWindowDimensions();
  if (!items.length) return null;
  return (
    <Card padding="none" className={className}>
      {items.map((item, index) => {
        const status = uploadStatusText(item, t, locale);
        const thumbnail =
          item.file.mimeType?.startsWith('image/') ||
          /\.(jpe?g|png|heic|gif|webp)$/i.test(item.file.name)
            ? item.file.uri
            : null;
        return (
          <View key={item.id}>
            {index > 0 ? <Divider inset={64} /> : null}
            <View className="min-h-[64px] flex-row items-center gap-3 py-2.5 pl-4 pr-2">
              <View
                className="flex-1 flex-row items-center gap-3"
                accessible
                accessibilityLabel={t('submissionUpload.row', { name: item.file.name, status })}
                accessibilityValue={
                  item.status === 'uploading' && item.fraction !== null
                    ? { min: 0, max: 100, now: Math.round(item.fraction * 100) }
                    : undefined
                }
              >
                <FileThumbnail
                  file={{
                    name: item.file.name,
                    filename: item.file.name,
                    contentType: item.file.mimeType ?? '',
                    thumbnailUrl: thumbnail,
                  }}
                />
                <View className="flex-1 gap-1">
                  <Text
                    variant="body"
                    weight="medium"
                    numberOfLines={fontScale > 1.3 ? undefined : 1}
                  >
                    {item.file.name}
                  </Text>
                  <View className="flex-row items-center gap-1.5">
                    {item.status === 'done' ? (
                      <Icon icon={CircleCheck} size={14} tone="success" />
                    ) : null}
                    <Text
                      variant="footnote"
                      tone={item.status === 'error' ? 'danger' : 'muted'}
                      numberOfLines={fontScale > 1.3 ? undefined : 2}
                      className="flex-1"
                      tabular
                    >
                      {status}
                    </Text>
                  </View>
                  {item.status === 'uploading' ? (
                    <ProgressBar value={item.fraction ?? 0.04} size="sm" className="mt-0.5" />
                  ) : null}
                </View>
              </View>
              {item.status === 'error' ? (
                <IconButton
                  icon={RotateCw}
                  accessibilityLabel={t('submissionUpload.retry', { name: item.file.name })}
                  onPress={() => {
                    if (eligible(item.id, true)) retryUpload(slot, item.id, client);
                  }}
                  disabled={disabled}
                />
              ) : null}
              <IconButton
                icon={X}
                accessibilityLabel={t('submissionUpload.remove', { name: item.file.name })}
                onPress={() => {
                  if (eligible(item.id, false)) removeUpload(slot, item.id);
                }}
                disabled={disabled}
              />
            </View>
          </View>
        );
      })}
    </Card>
  );
}
