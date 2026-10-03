import * as ExpoCrypto from 'expo-crypto';
// localStorage backed by SQLite on Android/iOS (viewSettings.ts and the remembered choices use it). No-op on web.
import 'expo-sqlite/localStorage/install';

// tasks.ts makes UIDs with the Web Crypto API, which React Native lacks; expo-crypto has the same two calls.
if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  globalThis.crypto = {
    getRandomValues: ExpoCrypto.getRandomValues,
    randomUUID: ExpoCrypto.randomUUID,
  } as unknown as Crypto;
}
