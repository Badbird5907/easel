import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { ArrowDown, ArrowUp, Camera, Image as ImageIcon, ScanLine, Trash2 } from 'lucide-react-native';
import { View } from 'react-native';

import { useCanvas } from '@/canvas/session';
import { Button, Callout, Card, EmptyState, IconButton, Screen, Text } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { hasDocumentScanner, useScanPages } from '@/features/submissions/scan';
import { useScanControls } from '@/features/submissions/scanControlsLifetime';
import { useTranslation } from '@/i18n';

/**
 * Scan a paper document into one PDF for a submission (ASSIGN-4): capture
 * pages, check and reorder them, then add the PDF to the submission's files.
 */
export default function ScanScreen() {
  const { courseId, assignmentId } = useLocalSearchParams<{ courseId: string; assignmentId: string }>();
  const { account, client } = useCanvas();
  const key = `${account.id}|${courseId}|${assignmentId}`;
  const pages = useScanPages(key);
  const { t } = useTranslation();
  const { busy, error, capture, fromPhotos, createPdf, edit, discard } = useScanControls(
    account.id,
    client,
    courseId,
    assignmentId,
    pages,
    t,
  );
  const captureLabel = t(hasDocumentScanner ? 'scanControls.scan' : 'scanControls.photo');

  return (
    <CourseScope courseId={courseId} title={t('scanControls.title')}>
      <Screen contentClassName="gap-5">
        {pages.length === 0 ? (
          <Card padding="none">
            <EmptyState
              icon={ScanLine}
              title={t('scanControls.emptyTitle')}
              description={t(hasDocumentScanner ? 'scanControls.scannerBody' : 'scanControls.cameraBody')}
            />
            <View className="gap-2.5 px-5 pb-6">
              <Button
                leadingIcon={hasDocumentScanner ? ScanLine : Camera}
                onPress={capture}
                loading={busy === 'capture'}
                disabled={!!busy}
              >
                {captureLabel}
              </Button>
              <Button variant="secondary" leadingIcon={ImageIcon} onPress={fromPhotos} disabled={!!busy}>
                {t('scanControls.choosePhotos')}
              </Button>
            </View>
          </Card>
        ) : (
          <>
            <View className="gap-1">
              <Text variant="title3" accessibilityRole="header">
                {t('scanControls.pages', { count: pages.length })}
              </Text>
              <Text variant="subhead" tone="muted">
                {t('scanControls.order')}
              </Text>
            </View>
            <View className="gap-3">
              {pages.map((page, index) => (
                <Card key={page.id} padding="sm" className="flex-row items-center gap-3">
                  <View
                    className="overflow-hidden rounded-lg bg-surface-sunken"
                    style={{ width: 72, height: 96, borderCurve: 'continuous' }}
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={t('scanControls.page', { count: index + 1 })}
                    accessibilityState={{ disabled: !!busy }}
                    accessibilityActions={[
                      ...(index > 0 ? [{ name: 'moveUp', label: t('scanControls.moveUp') }] : []),
                      ...(index < pages.length - 1
                        ? [{ name: 'moveDown', label: t('scanControls.moveDown') }]
                        : []),
                      { name: 'remove', label: t('scanControls.remove') },
                    ]}
                    onAccessibilityAction={(e) => {
                      edit(page.id, e.nativeEvent.actionName);
                    }}
                  >
                    <Image source={{ uri: page.uri }} style={{ width: 72, height: 96 }} contentFit="cover" />
                  </View>
                  <Text variant="headline" className="flex-1">
                    {t('scanControls.page', { count: index + 1 })}
                  </Text>
                  <View className="flex-row items-center gap-1">
                    <IconButton
                      icon={ArrowUp}
                      variant="secondary"
                      accessibilityLabel={t('scanControls.movePageUp', { count: index + 1 })}
                      disabled={index === 0 || !!busy}
                      onPress={() => edit(page.id, 'moveUp')}
                    />
                    <IconButton
                      icon={ArrowDown}
                      variant="secondary"
                      accessibilityLabel={t('scanControls.movePageDown', { count: index + 1 })}
                      disabled={index === pages.length - 1 || !!busy}
                      onPress={() => edit(page.id, 'moveDown')}
                    />
                    <IconButton
                      icon={Trash2}
                      variant="secondary"
                      accessibilityLabel={t('scanControls.removePage', { count: index + 1 })}
                      disabled={!!busy}
                      onPress={() => edit(page.id, 'remove')}
                    />
                  </View>
                </Card>
              ))}
            </View>
            <View className="flex-row gap-2.5">
              <Button
                variant="secondary"
                leadingIcon={hasDocumentScanner ? ScanLine : Camera}
                className="flex-1"
                onPress={capture}
                disabled={!!busy}
              >
                {t(hasDocumentScanner ? 'scanControls.scanMore' : 'scanControls.photo')}
              </Button>
              <Button
                variant="secondary"
                leadingIcon={ImageIcon}
                className="flex-1"
                onPress={fromPhotos}
                disabled={!!busy}
              >
                {t('scanControls.photos')}
              </Button>
            </View>
            <Button size="lg" onPress={createPdf} loading={busy === 'pdf'} disabled={!!busy}>
              {t('scanControls.addPdf', { count: pages.length })}
            </Button>
            <Button variant="ghost" onPress={discard} disabled={!!busy}>
              {t('scanControls.discardPages')}
            </Button>
          </>
        )}
        {busy ? (
          <Text tone="muted" accessibilityLiveRegion="polite">
            {t(busy === 'pdf' ? 'scanControls.building' : 'scanControls.capturing')}
          </Text>
        ) : null}
        {error ? (
          <Callout tone="warning" title={t('scanControls.errorTitle')}>
            {t(error)}
          </Callout>
        ) : null}
      </Screen>
    </CourseScope>
  );
}
