import { View } from 'react-native';

import { useSession } from '@/canvas/session';
import { Avatar, ListGroup, ListItem } from '@/design';
import { authFormsClaim, useAuthFormsLifetime } from '@/features/auth/authFormsLifetime';
import { SignInFlow } from '@/features/auth/SignInFlow';
import { confirmSignOut } from '@/features/auth/signOut';
import { useTranslation } from '@/i18n';

/**
 * Shown whenever no account is usable: first launch, or when Canvas stopped
 * accepting the active account's sign-in and it couldn't be refreshed.
 */
export default function SignInScreen() {
  const { t } = useTranslation();
  const { accounts, active, switchAccount, signOut } = useSession();
  const expired = active?.expired ? active : null;
  const others = accounts.filter((a) => a.id !== active?.id && !a.expired);
  const owner = useAuthFormsLifetime(JSON.stringify([expired?.id, others.map((a) => a.id)]));
  const revision = owner.revision;
  const eligible = () => owner.active && owner.revision === revision;

  return (
    <SignInFlow
      key={expired?.id ?? 'new'}
      showTitle
      expired={expired}
      footer={
        expired ? (
          <View className="gap-6">
            {others.length > 0 ? (
              <ListGroup header={t('authForms.switchTo')}>
                {others.map((account) => (
                  <ListItem
                    key={account.id}
                    leading={<Avatar name={account.user.name} uri={account.user.avatarUrl} size="sm" />}
                    title={account.user.name}
                    subtitle={account.host}
                    onPress={async () => {
                      const operation = authFormsClaim(owner, revision);
                      if (!operation) return;
                      try { await switchAccount(account.id); } finally { operation.release(); }
                    }}
                  />
                ))}
              </ListGroup>
            ) : null}
            <ListGroup>
              <ListItem
                title={t('authForms.remove', { name: expired.user.name })}
                subtitle={expired.host}
                destructive
                chevron={false}
                onPress={() => {
                  if (!eligible()) return;
                  confirmSignOut(expired, async (id) => {
                    const operation = authFormsClaim(owner, revision);
                    if (!operation) return;
                    try { await signOut(id); } finally { operation.release(); }
                  }, { remove: true });
                }}
              />
            </ListGroup>
          </View>
        ) : null
      }
    />
  );
}
