/**
 * Web has no background task, and expo-sqlite's web build needs a wasm asset
 * Metro isn't set up for, so offline state lives in localStorage there.
 */
const local = typeof localStorage === 'undefined' ? null : localStorage;

export const offlineKv = {
  getItemSync: (key: string): string | null => local?.getItem(key) ?? null,
  setItemSync: (key: string, value: string) => local?.setItem(key, value),
  removeItemSync: (key: string): boolean => {
    local?.removeItem(key);
    return true;
  },
  getAllKeysSync: (): string[] => (local ? Object.keys(local) : []),
};
