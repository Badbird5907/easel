import { Archive, ArchiveRestore, Mail, MailOpen, Star, StarOff, Trash2 } from 'lucide-react-native';
import { Alert } from 'react-native';
import { type Conversation, useDeleteConversation, useUpdateConversation } from '@/canvas/api/conversations';
import { useTranslation } from '@/i18n';
import { onceWhile, useBrowsingOwner } from './browsingLifetime';
import type { SheetOption } from './OptionsSheet';

type ErrorKey =
  | 'inboxBrowse.updateError'
  | 'inboxBrowse.moveError'
  | 'inboxBrowse.archiveError'
  | 'inboxBrowse.deleteError';

type Callbacks = {
  onDeleted?: () => void;
  onMarkedUnread?: () => void;
  /** Screen/filter/menu lifetime, independent of optimistic list removal. */
  isCurrent?: () => boolean;
  getCurrent?: () => Conversation | undefined;
};

/** Existing mutation hooks retain their original-account cache semantics. */
export function useConversationActions() {
  const update = useUpdateConversation();
  const remove = useDeleteConversation();
  const { t } = useTranslation();
  const owner = useBrowsingOwner('actions', { t });

  return (c: Conversation, callbacks: Callbacks = {}): SheetOption[] => {
    const { id, starred, unread, archived } = c;
    const current = () => owner.live && (callbacks.isCurrent?.() ?? true);
    const eligible = () => {
      const latest = callbacks.getCurrent ? callbacks.getCurrent() : c;
      return (
        current() &&
        !!latest &&
        latest.id === id &&
        latest.starred === starred &&
        latest.unread === unread &&
        latest.archived === archived
      );
    };
    const fail = (key: ErrorKey) => (error: Error) => {
      if (current()) Alert.alert(owner.value.t(key), error.message);
    };
    const change = (
      value: { id: string; starred?: boolean; state?: 'read' | 'unread' | 'archived' },
      key: ErrorKey,
      success?: () => void,
    ) => {
      if (!eligible() || owner.claims.has(id)) return;
      owner.claims.add(id);
      update.mutate(value, {
        onError: fail(key),
        onSuccess: () => {
          if (current()) success?.();
        },
        onSettled: () => {
          owner.claims.delete(id);
        },
      });
    };
    return [
      {
        key: 'star',
        label: t(starred ? 'inboxBrowse.unstar' : 'inboxBrowse.star'),
        icon: starred ? StarOff : Star,
        onPress: onceWhile(eligible, () => change({ id: id, starred: !starred }, 'inboxBrowse.updateError')),
      },
      {
        key: 'read',
        label: t(unread ? 'inboxBrowse.read' : 'inboxBrowse.markUnread'),
        icon: unread ? MailOpen : Mail,
        onPress: onceWhile(eligible, () =>
          change(
            { id: id, state: unread ? 'read' : 'unread' },
            'inboxBrowse.updateError',
            unread ? undefined : callbacks.onMarkedUnread,
          ),
        ),
      },
      {
        key: 'archive',
        label: t(archived ? 'inboxBrowse.move' : 'inboxBrowse.archive'),
        icon: archived ? ArchiveRestore : Archive,
        onPress: onceWhile(eligible, () =>
          change(
            { id: id, state: archived ? 'read' : 'archived' },
            archived ? 'inboxBrowse.moveError' : 'inboxBrowse.archiveError',
          ),
        ),
      },
      {
        key: 'delete',
        label: t('inboxBrowse.deleteConversation'),
        icon: Trash2,
        destructive: true,
        onPress: onceWhile(eligible, () => {
          const key = `confirm:${id}`;
          if (owner.claims.has(key) || owner.claims.has(id)) return;
          owner.claims.add(key);
          let answered = false;
          const cancel = () => {
            if (answered) return;
            answered = true;
            owner.claims.delete(key);
          };
          Alert.alert(
            owner.value.t('inboxBrowse.deleteConversationTitle'),
            owner.value.t('inboxBrowse.deleteConversationBody'),
            [
              { text: owner.value.t('inboxBrowse.cancel'), style: 'cancel', onPress: cancel },
              {
                text: owner.value.t('inboxBrowse.delete'),
                style: 'destructive',
                onPress: () => {
                  if (answered) return;
                  cancel();
                  if (!eligible() || owner.claims.has(id)) return;
                  owner.claims.add(id);
                  remove.mutate(id, {
                    onSuccess: () => {
                      if (current()) callbacks.onDeleted?.();
                    },
                    onError: fail('inboxBrowse.deleteError'),
                    onSettled: () => {
                      owner.claims.delete(id);
                    },
                  });
                },
              },
            ],
            { onDismiss: cancel },
          );
        }),
      },
    ];
  };
}
