import { router } from 'expo-router';
import { Check, Plus } from 'lucide-react-native';
import { View } from 'react-native';

import { type Account, useSession } from '@/canvas/session';
import { Avatar, Badge, haptics, Icon, IconTile, ListGroup, ListItem, Sheet } from '@/design';
import { useTranslation } from '@/i18n';

import { badgeText, unreadLabel, useAccountBadges } from './badges';

type RowProps = {
  account: Account;
  current: boolean;
  unread: number | undefined;
  onPress: () => void;
  /** Settings opens the profile for the current account; the switcher just closes. */
  currentHint?: string;
};

/** One account: picture, name, school, unread count, and a check on the current one (ACCT-2, ACCT-5). */
export function AccountRow({ account, current, unread, onPress, currentHint }: RowProps) {
  const { t, locale } = useTranslation();
  const school = account.expired ? t('accounts.expiredSchool', { school: account.host }) : account.host;
  return (
    <ListItem
      leading={<Avatar name={account.user.name} uri={account.user.avatarUrl} />}
      title={account.user.name}
      subtitle={current && currentHint ? `${school} · ${currentHint}` : school}
      accessibilityRole={currentHint ? 'button' : 'radio'}
      accessibilityState={currentHint ? undefined : { checked: current }}
      accessibilityLabel={[
        account.user.name,
        account.host,
        account.expired ? t('accounts.needsSignIn') : null,
        unreadLabel(unread, t),
        current ? t('accounts.current') : null,
        current && currentHint ? currentHint : null,
      ]
        .filter(Boolean)
        .join(', ')}
      trailing={
        <View className="flex-row items-center gap-2">
          {unread ? (
            <Badge tone="accent" variant="solid" size="sm">
              {badgeText(unread, locale)}
            </Badge>
          ) : null}
          {current && !currentHint ? <Icon icon={Check} tone="accent" strokeWidth={2.25} /> : null}
        </View>
      }
      chevron={current && !!currentHint}
      onPress={onPress}
    />
  );
}

/**
 * Quick switch (ACCT-4): every account with its unread count, plus "Add
 * account". Opened by a long press on Home's Settings button, or its
 * accessibility action.
 */
export function AccountSwitcherSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { accounts, active, switchAccount } = useSession();
  const badges = useAccountBadges({ active: visible });

  return (
    <Sheet visible={visible} title={t('home.switchAccount')} onClose={onClose}>
      <ListGroup footer={t('accounts.switchHint')}>
        {accounts.map((account) => {
          const current = account.id === active?.id;
          return (
            <AccountRow
              key={account.id}
              account={account}
              current={current}
              unread={badges[account.id]}
              onPress={() => {
                onClose();
                if (current) return;
                haptics.selection();
                switchAccount(account.id);
              }}
            />
          );
        })}
        <ListItem
          leading={<IconTile icon={Plus} tone="neutral" />}
          title={t('nav.addAccount')}
          onPress={() => {
            onClose();
            router.push('/add-account');
          }}
        />
      </ListGroup>
    </Sheet>
  );
}
