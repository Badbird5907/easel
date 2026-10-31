import { LocalStore, useLocalStore } from '@/features/offline/store';

/*
 * Whether what-if scores are saved to Canvas (GRADE-5). Off by default:
 * what-if scores stay on this screen unless the student asks to keep them,
 * as on the web's grades page, where they then show too.
 */
const store = new LocalStore<boolean>('grades.saveWhatIf', () => false);

export function useSaveWhatIf(): boolean {
  return useLocalStore(store);
}

export function setSaveWhatIf(on: boolean) {
  store.set(on);
}
