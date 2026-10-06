import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LogoMark } from './components/LogoMark.tsx';
import { Navigation } from './navigation.tsx';
import { SessionProvider, useSession } from './state/session.tsx';
import { useColors } from './theme.ts';

// The native splash screen stays up while the saved login is tried, so the login screen never flashes by.
void SplashScreen.preventAutoHideAsync();

export function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <Main />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function Main() {
  const { restoring } = useSession();

  useEffect(() => {
    if (!restoring) SplashScreen.hide();
  }, [restoring]);

  // The navigator starts once the session is known, so a link to /tasks/<uid> isn't sent to /login first.
  // The web has no splash screen to cover the wait, so it gets one of its own.
  if (restoring) return Platform.OS === 'web' ? <WebSplash /> : null;
  return <Navigation />;
}

function WebSplash() {
  const colors = useColors();
  return (
    <View style={[styles.splash, { backgroundColor: colors.bg }]}>
      <LogoMark size={48} />
      <ActivityIndicator color={colors.textTertiary} aria-label="Logging in" />
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
});
