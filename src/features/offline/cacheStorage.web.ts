import AsyncStorage from '@react-native-async-storage/async-storage';

/** Web keeps the query cache in localStorage, through AsyncStorage (expo-sqlite's web build needs wasm). */
export const cacheStorage = AsyncStorage;
