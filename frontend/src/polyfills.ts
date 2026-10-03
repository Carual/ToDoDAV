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

// Hermes has no Intl.ListFormat, which format.ts uses for repeat rules in words ("Monday, Wednesday, and Friday").
// It only ever asks for English, so this covers English lists ("and" and "or", with the serial comma).
if (typeof Intl.ListFormat !== 'function') {
  class EnglishListFormat {
    private readonly word: string;
    constructor(_locale?: string, options?: { type?: 'conjunction' | 'disjunction' | 'unit' }) {
      this.word = options?.type === 'disjunction' ? 'or' : 'and';
    }
    format(list: Iterable<string>): string {
      const items = [...list];
      if (items.length < 3) return items.join(` ${this.word} `);
      return `${items.slice(0, -1).join(', ')}, ${this.word} ${items.at(-1)}`;
    }
  }
  (Intl as { ListFormat: unknown }).ListFormat = EnglishListFormat;
}
