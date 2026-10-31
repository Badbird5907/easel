import { useMemo, useSyncExternalStore } from 'react';
import { createTranslator, getLocaleState, subscribeLocale } from './runtime';
export * from './runtime';
export type { Translate, MessageKey, Catalog } from './types';

/** Subscribe inside memoized rows too; locale changes never need a network refetch. */
export function useTranslation() {
  const state = useSyncExternalStore(subscribeLocale, getLocaleState, getLocaleState);
  const t = useMemo(() => createTranslator(state.locale), [state.locale]);
  return { ...state, t };
}
