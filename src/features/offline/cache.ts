import type { QueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Directory, Paths } from 'expo-file-system';

import { cacheStorage } from './cacheStorage';
import { cachePersister } from './persist';

/*
 * The cache Easel keeps so screens open offline (SET-10): saved Canvas data
 * (the persisted query cache) and images. Clearing it never touches
 * downloaded files or synced courses; those have their own controls.
 */

/** The key the persisted query cache is saved under (see persist.ts). */
const CACHE_KEY = 'easel.query-cache';

/**
 * Bytes of saved Canvas data. Measures the saved entry rather than the
 * database file, which SQLite doesn't shrink when data is removed.
 */
export async function savedDataSize(): Promise<number> {
  try {
    const saved = await cacheStorage.getItem(CACHE_KEY);
    if (!saved) return 0;
    // UTF-8 bytes; most of it is ASCII.
    return new TextEncoder().encode(saved).length;
  } catch {
    return 0;
  }
}

/** Bytes of images Easel has cached. */
export function imageCacheSize(): number {
  try {
    let total = 0;
    for (const entry of Paths.cache.list()) {
      // expo-image keeps its disk cache in folders named after the image library it uses.
      if (entry instanceof Directory && /image|sdwebimage|glide/i.test(entry.name)) total += entry.size ?? 0;
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Forgets saved Canvas data and cached images. Screens on display load again
 * right away; everything else loads the next time it opens.
 */
export async function clearCache(queryClient: QueryClient) {
  await queryClient.cancelQueries();
  queryClient.removeQueries({ type: 'inactive' });
  await cachePersister.removeClient();
  await Promise.allSettled([Image.clearDiskCache(), Image.clearMemoryCache()]);
  await queryClient.resetQueries({ type: 'active' }).catch(() => {});
}
