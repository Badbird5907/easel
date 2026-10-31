import { useEffect, useMemo, useState } from 'react';
import { Alert, AppState, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { acceptTerms, fetchRequiresTerms } from '@/canvas/api/legal';
import { type PendingSignIn, useCanvas, useSession } from '@/canvas/session';
import { haptics } from '@/design';
import { TermsStep } from '@/features/auth/TermsStep';
import {
  authTermsClaim,
  authTermsClose,
  authTermsRetire,
  useAuthTermsLifetime,
} from '@/features/auth/authTermsLifetime';
import { useTranslation } from '@/i18n';
import { isOnline } from '@/features/offline/connectivity';

/** Ask Canvas at most this often per account: on launch, then on returning to the app. */
const CHECK_EVERY_MS = 30 * 60_000;
const lastChecked = new Map<string, number>();

/** Reuse an entered read during effect replay without publishing its retired callback. */
function createCheckRequest(client: Parameters<typeof fetchRequiresTerms>[0], identity: object) {
  let pending: Promise<boolean> | null = null;
  return {
    identity,
    get pending() {
      return pending !== null;
    },
    read() {
      if (pending) return pending;
      const request = fetchRequiresTerms(client).finally(() => {
        if (pending === request) pending = null;
      });
      pending = request;
      return request;
    },
    retire() {
      pending = null;
    },
  };
}

/**
 * Terms of use that changed after sign-in (AUTH-7). Canvas reports it with the
 * session token (`requires_terms_acceptance`); when it does, the school's new
 * terms cover the app until the student accepts them or signs out.
 */
export function TermsRecheck() {
  const { account, client } = useCanvas();
  const { signOut } = useSession();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const identity = useMemo(() => ({ id: account.id, client }), [account.id, client]);
  const owner = useAuthTermsLifetime(identity);
  const checkRequest = useMemo(() => createCheckRequest(client, owner), [client, owner]);
  const [needed, setNeeded] = useState<{ owner: typeof owner } | null>(null);
  // Remounts the terms after "Cancel" on signing out, so its buttons work again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const check = async () => {
      const last = lastChecked.get(account.id) ?? 0;
      if ((!checkRequest.pending && Date.now() - last < CHECK_EVERY_MS) || !isOnline()) return;
      const operation = authTermsClaim(owner);
      if (!operation) return;
      lastChecked.set(account.id, Date.now());
      try {
        const required = await checkRequest.read();
        if (operation.current() && required)
          setNeeded((current) => (current?.owner === owner ? current : { owner }));
      } catch {
        // The shared fetcher currently catches server failures. No passive acceptance or signout.
      } finally {
        operation.release();
      }
    };
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      sub.remove();
    };
  }, [account.id, checkRequest, owner]);

  const visible = needed?.owner === owner;
  const actionIdentity = useMemo(() => ({ owner, needed, attempt }), [owner, needed, attempt]);
  const actionOwner = useAuthTermsLifetime(actionIdentity);
  // TermsStep reads only the account and its client; the credentials stay in the session.
  const pending = { account, client } as PendingSignIn;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => {}}
    >
      <View className="flex-1 bg-bg">
        <ScrollView
          contentContainerClassName="px-5"
          contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
        >
          {visible ? (
            <TermsStep
              key={attempt}
              pending={pending}
              showHeading
              onAccept={async () => {
                const operation = authTermsClaim(actionOwner);
                if (!operation) return;
                // A passive check already in flight must not replace this decision.
                authTermsRetire(owner);
                checkRequest.retire();
                try {
                  await acceptTerms(client);
                  if (!operation.current()) return;
                  haptics.success();
                  authTermsRetire(owner);
                  checkRequest.retire();
                  authTermsClose(actionOwner);
                  setNeeded(null);
                } catch (error) {
                  if (operation.current()) {
                    operation.release();
                    throw error;
                  }
                }
              }}
              onDecline={async () => {
                const operation = authTermsClaim(actionOwner);
                if (!operation) return;
                authTermsRetire(owner);
                checkRequest.retire();
                Alert.alert(
                  t('authTerms.signOutTitle', { name: account.host }),
                  t('authTerms.signOutBody'),
                  [
                    {
                      text: t('authTerms.cancel'),
                      style: 'cancel',
                      onPress: () => {
                        if (!operation.current()) return;
                        authTermsClose(actionOwner);
                        authTermsRetire(owner);
                        checkRequest.retire();
                        setAttempt((n) => n + 1);
                      },
                    },
                    {
                      text: t('authTerms.signOut'),
                      style: 'destructive',
                      onPress: () => {
                        if (!operation.current()) return;
                        authTermsClose(actionOwner);
                        authTermsRetire(owner);
                        checkRequest.retire();
                        setNeeded(null);
                        signOut(account.id).catch(() => {});
                      },
                    },
                  ],
                );
              }}
            />
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
