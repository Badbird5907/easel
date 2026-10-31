import { Alert, Linking, Platform } from 'react-native';
import { createTranslator } from '@/i18n/runtime';
import type { Translate } from '@/i18n';

/**
 * Respondus LockDown Browser (QUIZ-7). Its app registers the `rldb:` URL
 * scheme and opens the Canvas address it's given. Neither official Canvas app
 * links to it, so this follows Respondus's own launch links. iOS only reports
 * whether it's installed when the scheme is listed in `LSApplicationQueriesSchemes`,
 * so Easel tries to open it and offers the store when that fails.
 */
export function lockdownUrl(quizUrl: string): string {
  return `rldb://${quizUrl.replace(/^https?:\/\//, '')}`;
}

const STORE_URL =
  Platform.OS === 'ios'
    ? 'itms-apps://search.itunes.apple.com/WebObjects/MZSearch.woa/wa/search?media=software&term=Respondus%20LockDown%20Browser'
    : 'market://search?q=Respondus%20LockDown%20Browser&c=apps';
const STORE_WEB =
  Platform.OS === 'ios'
    ? 'https://apps.apple.com/search?term=Respondus%20LockDown%20Browser'
    : 'https://play.google.com/store/search?q=Respondus%20LockDown%20Browser&c=apps';

/** Legacy callers retain English and unguarded resource lifetime by default. */
export async function openLockdownBrowser(
  quizUrl: string,
  context: { t?: Translate; valid?: () => boolean; finished?: () => void } = {},
) {
  const t = context.t ?? createTranslator('en');
  const valid = context.valid ?? (() => true);
  if (!valid()) return;
  try {
    await Linking.openURL(lockdownUrl(quizUrl));
    context.finished?.();
  } catch {
    if (!valid()) return;
    let chosen = false;
    Alert.alert(
      t('quizEntry.notInstalled'),
      t('quizEntry.installBody'),
      [
        { text: t('quizEntry.notNow'), style: 'cancel', onPress: () => { if (!chosen) { chosen = true; context.finished?.(); } } },
        {
          text: t(Platform.OS === 'ios' ? 'quizEntry.appStore' : 'quizEntry.playStore'),
          onPress: async () => {
            if (chosen || !valid()) return;
            chosen = true;
            try { await Linking.openURL(STORE_URL); }
            catch {
              if (!valid()) return;
              try { await Linking.openURL(STORE_WEB); } catch { /* Same best-effort fallback. */ }
            } finally { context.finished?.(); }
          },
        },
      ],
    );
  }
}
