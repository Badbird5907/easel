import { Alert } from 'react-native';

import type { Account } from '@/canvas/session';
import { activeUploadCount } from '@/features/submissions/uploadStore';
import { createTranslator, displayLocale, t } from '@/i18n/runtime';
import type { Translate } from '@/i18n/types';

/** What signing out does to this account, in the confirmation (AUTH-10). */
export function signOutMessage(account: Account, translate: Translate = t): string {
  return account.authMethod === 'oauth'
    ? translate('accounts.signOutOAuth', { school: account.host })
    : // A personal access token belongs to the student; Easel can't revoke it, only forget it.
      translate('accounts.signOutToken', { school: account.host });
}

/** Asks before signing out or removing an account. */
export function confirmSignOut(
  account: Account,
  signOut: (id: string) => Promise<void>,
  { remove = false }: { remove?: boolean } = {},
) {
  // The person viewing Settings chooses the language, even when removing a different account.
  const translate = createTranslator(displayLocale());
  // Read at confirmation time so every caller, including account removal, gets a fresh count.
  const uploads = activeUploadCount(account.id);
  const warning = uploads
    ? `\n\n${translate('accounts.uploadWarning', { count: uploads })}`
    : '';
  Alert.alert(
    translate(remove ? 'accounts.removeConfirm' : 'accounts.signOutConfirm', { name: account.user.name }),
    signOutMessage(account, translate) + warning,
    [
      { text: translate('common.cancel'), style: 'cancel' },
      {
        text: translate(remove ? 'accounts.remove' : 'accounts.signOut'),
        style: 'destructive',
        onPress: () => {
          signOut(account.id).catch(() => {});
        },
      },
    ],
  );
}
