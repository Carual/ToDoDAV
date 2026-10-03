import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { SessionProvider, useSession } from '../session.tsx';
import { useColors } from '../theme.ts';

// The native splash screen stays up while the saved login is tried, so the login screen never flashes by.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SessionProvider>
      <RootStack />
    </SessionProvider>
  );
}

function RootStack() {
  const { session, restoring } = useSession();
  const scheme = useColorScheme();
  const colors = useColors();

  useEffect(() => {
    if (!restoring) SplashScreen.hide();
  }, [restoring]);

  if (restoring) return null;

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, background: colors.bg, text: colors.text, primary: colors.accent } };
  // Protected screens: without a session only /login exists, with one only the app (/tasks..., /journal...).
  // Logging in or out removes the screen the user was on, and the router moves to the first one available.
  // Tasks and Journal are the TopBar's tabs: `dangerouslySingular` keeps one of each, so switching brings the other
  // back to the top as it was left (lists, scroll position) instead of stacking a new copy, and Back returns to the
  // one shown before.
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Protected guard={session !== null}>
          <Stack.Screen name="tasks" dangerouslySingular options={{ animation: 'none' }} />
          <Stack.Screen name="journal" dangerouslySingular options={{ animation: 'none' }} />
        </Stack.Protected>
        <Stack.Protected guard={session === null}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
