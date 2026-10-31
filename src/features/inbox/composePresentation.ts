import type { Recipient } from '@/canvas/api/conversations';
import type { Translate } from '@/i18n';

/** Only locally generated prefill names carry provenance; legacy values stay raw. */
export type ComposeRecipient = Recipient & { composeNameOrigin?: 'missing-prefill' };
export function composeRecipientName(recipient: ComposeRecipient, t: Translate) {
  return recipient.composeNameOrigin === 'missing-prefill' ? t('inboxCompose.unknown') : recipient.name;
}
