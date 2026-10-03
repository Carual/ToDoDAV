import { Stack } from 'expo-router';
import { View } from 'react-native';

import { Toast } from '../../components/Toast.tsx';
import { JournalsProvider, useJournals } from '../../journalsContext.tsx';
import { useColors } from '../../theme.ts';

// An entry link opened directly (/journal/<uid>) still gets the Journal page under it, as for tasks.
export const unstable_settings = { initialRouteName: 'index' };

/** The Journal page (/journal) with an entry (/journal/<uid>) over it, both reading JournalsProvider. */
export default function JournalLayout() {
  return (
    <JournalsProvider>
      <JournalStack />
    </JournalsProvider>
  );
}

function JournalStack() {
  const colors = useColors();
  const { toast, dismissToast } = useJournals();
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen
          name="[uid]"
          // Transparent: the entry draws its own backdrop (a dimmed page on wide screens) or covers the screen.
          options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }}
        />
      </Stack>
      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </View>
  );
}
