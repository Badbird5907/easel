/** expo-sqlite's web build needs a wasm asset Metro isn't set up for, so web uses localStorage. */
const local = typeof localStorage === 'undefined' ? null : localStorage;

export const settingsKv = {
  getItemSync: (key: string): string | null => local?.getItem(key) ?? null,
  setItemSync: (key: string, value: string) => local?.setItem(key, value),
};
