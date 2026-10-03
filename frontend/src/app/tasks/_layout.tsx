import { Stack } from 'expo-router';
import { View } from 'react-native';

import { Toast } from '../../components/Toast.tsx';
import { TasksProvider, useTasks } from '../../tasksContext.tsx';
import { useColors } from '../../theme.ts';

// A task link opened directly (/tasks/<uid>) still gets the list under it, for the backdrop and for closing.
export const unstable_settings = { initialRouteName: 'index' };

/**
 * The list (/tasks) with the task page (/tasks/<uid>) over it. Both read the same tasks from TasksProvider, so the
 * list stays as it is under the task, and opening one shows it at once.
 */
export default function TasksLayout() {
  return (
    <TasksProvider>
      <TasksStack />
    </TasksProvider>
  );
}

function TasksStack() {
  const colors = useColors();
  const { toast, dismissToast } = useTasks();
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen
          name="[uid]"
          // Transparent: the task draws its own backdrop (a dimmed list on wide screens) or covers the screen.
          options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }}
        />
      </Stack>
      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </View>
  );
}
