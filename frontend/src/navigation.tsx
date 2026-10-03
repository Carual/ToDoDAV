import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type LinkingOptions,
  type NavigatorScreenParams,
} from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationOptions } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { View, useColorScheme } from 'react-native';

import { Toast } from './components/controls/Toast.tsx';
import { EntryScreen } from './screens/EntryScreen.tsx';
import { JournalScreen } from './screens/JournalScreen.tsx';
import { LoginScreen } from './screens/LoginScreen.tsx';
import { TaskScreen } from './screens/TaskScreen.tsx';
import { TasksScreen } from './screens/TasksScreen.tsx';
import { JournalsProvider, useJournals } from './state/journalsContext.tsx';
import { useSession } from './state/session.tsx';
import { TasksProvider, useTasks } from './state/tasksContext.tsx';
import { useColors } from './theme.ts';

// Every screen of the app, its URL and how it is shown. Nothing depends on file names.
//
//   Login           /login            only without a session
//   Tasks           (section)         only with a session; TasksProvider for both screens below
//     TaskList      /tasks
//     Task          /tasks/<uid>      over the list
//   Journal         (section)         likewise, with JournalsProvider
//     EntryList     /journal
//     Entry         /journal/<uid>    over the page

export type RootParams = {
  Login: undefined;
  Tasks: NavigatorScreenParams<TasksParams> | undefined;
  Journal: NavigatorScreenParams<JournalParams> | undefined;
};
export type TasksParams = { TaskList: undefined; Task: { uid: string } };
export type JournalParams = { EntryList: undefined; Entry: { uid: string } };

declare global {
  namespace ReactNavigation {
    // Types useNavigation() and useLinkProps() everywhere.
    interface RootParamList extends RootParams {}
  }
}

const linking: LinkingOptions<RootParams> = {
  // The web build reads the browser's address; on Android/iOS, tododav:// links (exp:// in Expo Go).
  prefixes: [Linking.createURL('/')],
  config: {
    screens: {
      Login: 'login',
      // initialRouteName: a task link opened directly still gets the list under it, for the backdrop and for closing.
      Tasks: { path: 'tasks', initialRouteName: 'TaskList', screens: { TaskList: '', Task: ':uid' } },
      Journal: { path: 'journal', initialRouteName: 'EntryList', screens: { EntryList: '', Entry: ':uid' } },
    },
  },
};

const Root = createNativeStackNavigator<RootParams>();
const TasksStack = createNativeStackNavigator<TasksParams>();
const JournalStack = createNativeStackNavigator<JournalParams>();

/** Transparent: the task or entry draws its own backdrop (a dimmed list on wide screens) or covers the screen. */
const overList: NativeStackNavigationOptions = {
  presentation: 'transparentModal',
  animation: 'fade',
  contentStyle: { backgroundColor: 'transparent' },
};

/** Tasks and Journal are the TopBar's tabs: one of each (a fixed id), so switching brings the other back as it was. */
const singular = () => 'singular';

export function Navigation() {
  const { session } = useSession();
  const scheme = useColorScheme();
  const colors = useColors();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, background: colors.bg, text: colors.text, primary: colors.accent } };
  const screenOptions: NativeStackNavigationOptions = { headerShown: false, contentStyle: { backgroundColor: colors.bg } };

  // Without a session only Login exists, with one only the sections: logging in or out swaps them, and the
  // navigator shows the first one available.
  return (
    <NavigationContainer linking={linking} theme={theme} documentTitle={{ enabled: false }}>
      <Root.Navigator screenOptions={screenOptions}>
        {session === null ? (
          <Root.Screen name="Login" component={LoginScreen} />
        ) : (
          <>
            <Root.Screen name="Tasks" component={TasksSection} getId={singular} options={{ animation: 'none' }} />
            <Root.Screen name="Journal" component={JournalSection} getId={singular} options={{ animation: 'none' }} />
          </>
        )}
      </Root.Navigator>
    </NavigationContainer>
  );
}

/** The list with the task over it. Both read TasksProvider, so the list stays as it is under the task. */
function TasksSection() {
  return (
    <TasksProvider>
      <TasksScreens />
    </TasksProvider>
  );
}

function TasksScreens() {
  const colors = useColors();
  const { toast, dismissToast } = useTasks();
  return (
    <View style={{ flex: 1 }}>
      <TasksStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <TasksStack.Screen name="TaskList" component={TasksScreen} />
        <TasksStack.Screen name="Task" component={TaskScreen} options={overList} />
      </TasksStack.Navigator>
      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </View>
  );
}

/** The Journal page with an entry over it, both reading JournalsProvider. */
function JournalSection() {
  return (
    <JournalsProvider>
      <JournalScreens />
    </JournalsProvider>
  );
}

function JournalScreens() {
  const colors = useColors();
  const { toast, dismissToast } = useJournals();
  return (
    <View style={{ flex: 1 }}>
      <JournalStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <JournalStack.Screen name="EntryList" component={JournalScreen} />
        <JournalStack.Screen name="Entry" component={EntryScreen} options={overList} />
      </JournalStack.Navigator>
      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </View>
  );
}
