import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Credentials, Transport } from '../api/caldav.ts';

export interface StoredLogin extends Credentials {
  transport: Transport;
}

// Web: sessionStorage, which survives a reload but is gone when the tab closes (never localStorage), with the same
// key as frontend-react. The web build always goes through the /proxy of the server it was loaded from.
// Android/iOS: the Keystore/Keychain through expo-secure-store, so the app stays logged in.
const KEY = 'tododav.credentials';
const SAME_ORIGIN: Transport = { kind: 'proxy', origin: '' };

export async function readLogin(): Promise<StoredLogin | null> {
  try {
    const raw = Platform.OS === 'web' ? sessionStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredLogin>;
    if (typeof stored.username !== 'string' || typeof stored.password !== 'string') return null;
    const transport = Platform.OS === 'web' ? SAME_ORIGIN : stored.transport;
    return transport ? { username: stored.username, password: stored.password, transport } : null;
  } catch {
    return null;
  }
}

export async function writeLogin(login: StoredLogin | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (login) sessionStorage.setItem(KEY, JSON.stringify({ username: login.username, password: login.password }));
      else sessionStorage.removeItem(KEY);
    } else if (login) {
      await SecureStore.setItemAsync(KEY, JSON.stringify(login));
    } else {
      await SecureStore.deleteItemAsync(KEY);
    }
  } catch {
    // Without storage the user simply logs in again next time.
  }
}

// The server address and username typed last, to fill in the login form after logging out. Not secret, so they
// go in localStorage (SQLite on Android/iOS); the password never does.
const LAST_KEY = 'tododav.lastLogin';

export function readLastLogin(): { server: string; username: string } {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    const last = raw ? (JSON.parse(raw) as { server?: unknown; username?: unknown }) : {};
    return {
      server: typeof last.server === 'string' ? last.server : '',
      username: typeof last.username === 'string' ? last.username : '',
    };
  } catch {
    return { server: '', username: '' };
  }
}

export function writeLastLogin(server: string, username: string) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ server, username }));
  } catch {
    // Only a convenience.
  }
}
