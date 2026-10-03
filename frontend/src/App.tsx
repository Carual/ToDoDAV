import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Navigation } from './navigation.tsx';
import { SessionProvider, useSession } from './state/session.tsx';

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
  if (restoring) return null;
  return <Navigation />;
}
