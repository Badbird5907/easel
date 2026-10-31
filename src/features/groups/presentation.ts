import { GroupMembershipError, type GroupDetail } from '@/canvas/api/groups';
import type { Translate } from '@/i18n';

export function memberLine(g: GroupDetail, limit: number | null, t: Translate, locale: string) {
  const max = g.maxMembers ?? limit;
  return max
    ? t('groups.capacity', { count: g.membersCount, max: new Intl.NumberFormat(locale).format(max) })
    : t('groups.members', { count: g.membersCount });
}

export function membershipErrorMessage(error: Error, t: Translate): string {
  return error instanceof GroupMembershipError ? t(`groups.error.${error.reason}`) : error.message;
}
