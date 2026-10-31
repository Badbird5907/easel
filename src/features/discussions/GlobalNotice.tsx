import { CalendarDays, CircleAlert, CircleHelp, Info, TriangleAlert } from 'lucide-react-native';
import { Pressable } from 'react-native';

import type { AccountNotification } from '@/canvas/api/announcements';
import { htmlToText } from '@/canvas/html';
import { Callout, Text } from '@/design';
import { RichContent } from '@/features/content/RichContent';
import { useTranslation } from '@/i18n';

const noticeStyle = {
  warning: { tone: 'warning', icon: TriangleAlert },
  error: { tone: 'danger', icon: CircleAlert },
  information: { tone: 'info', icon: Info },
  question: { tone: 'info', icon: CircleHelp },
  calendar: { tone: 'accent', icon: CalendarDays },
} as const;

type GlobalNoticeProps = {
  notice: AccountNotification;
  onDismiss: () => void;
  /**
   * Shows a two-line plain-text preview that opens the full notice when tapped.
   * Home uses it so school notices don't push what's due off the screen.
   */
  onPress?: () => void;
};

/** A school-wide announcement from the student's institution (ANN-5, HOME-5). */
export function GlobalNotice({ notice, onDismiss, onPress }: GlobalNoticeProps) {
  const { t } = useTranslation();
  const style = noticeStyle[notice.kind] ?? noticeStyle.information;
  const callout = (
    <Callout
      tone={style.tone}
      icon={style.icon}
      title={notice.subject}
      action={{
        label: t('common.dismiss'),
        accessibilityLabel: t('notice.dismiss', { subject: notice.subject }),
        onPress: onDismiss,
      }}
    >
      {onPress ? (
        <Text variant="subhead" tone="muted" numberOfLines={2}>
          {htmlToText(notice.html)}
        </Text>
      ) : (
        <RichContent html={notice.html} variant="subhead" />
      )}
    </Callout>
  );
  if (!onPress) return callout;
  return (
    <Pressable
      onPress={onPress}
      accessibilityHint={t('notice.openHint')}
      className="active:opacity-80"
    >
      {callout}
    </Pressable>
  );
}
