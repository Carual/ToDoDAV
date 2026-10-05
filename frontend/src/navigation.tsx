import {
  createNavigationContainerRef,
  DarkTheme,
  DefaultTheme,
  getStateFromPath,
  NavigationContainer,
  type LinkingOptions,
  type NavigatorScreenParams,
} from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationOptions } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useRef } from 'react';
import { useColorScheme } from 'react-native';

import { ToastProvider } from './components/controls/Toast.tsx';
import { Entry } from './screens/Entry.tsx';
import { Journal } from './screens/Journal.tsx';
import { Login } from './screens/Login.tsx';
import { Task } from './screens/Task.tsx';
import { Tasks } from './screens/Tasks.tsx';
import { JournalsProvider } from './state/journalsContext.tsx';
import { useSession } from './state/session.tsx';
import { TasksProvider } from './state/tasksContext.tsx';
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

/** A path into the app (a task, an entry, a list), as opposed to /login or one the app doesn't know. */
const APP_PATH = /^\/?(tasks|journal)(\/|\?|$)/;

const navigationRef = createNavigationContainerRef<RootParams>();

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

  // A link opened without a session (at startup, or while the login screen is up) can only show Login. It is kept
  // and followed after logging in, as frontend-react did, so a task link from a calendar still reaches the task.
  // getStateFromPath sees every link with its prefix already removed, on the web and on Android/iOS alike.
  const signedIn = useRef(session !== null);
  signedIn.current = session !== null;
  const pendingPath = useRef<string | null>(null);
  const withPendingLinks = useMemo<LinkingOptions<RootParams>>(
    () => ({
      ...linking,
      getStateFromPath: (path, options) => {
        if (!signedIn.current && APP_PATH.test(path)) pendingPath.current = path;
        return getStateFromPath(path, options);
      },
    }),
    [],
  );

  useEffect(() => {
    const path = pendingPath.current;
    if (session === null || path === null) return;
    pendingPath.current = null;
    // Runs after the navigator has swapped Login for the sections, so the link's screens exist.
    const state = getStateFromPath(path, linking.config);
    if (state) navigationRef.resetRoot(state);
  }, [session]);

  // Without a session only Login exists, with one only the sections: logging in or out swaps them, and the
  // navigator shows the first one available. The toast (Undo, Retry...) sits over every screen.
  return (
    <NavigationContainer ref={navigationRef} linking={withPendingLinks} theme={theme} documentTitle={{ enabled: false }}>
      <ToastProvider>
        <Root.Navigator screenOptions={useScreenOptions()}>
          {session === null ? (
            <Root.Screen name="Login" component={Login} />
          ) : (
            <>
              <Root.Screen name="Tasks" component={TasksSection} getId={singular} options={{ animation: 'none' }} />
              <Root.Screen name="Journal" component={JournalSection} getId={singular} options={{ animation: 'none' }} />
            </>
          )}
        </Root.Navigator>
      </ToastProvider>
    </NavigationContainer>
  );
}

/** The list with the task over it. Both read TasksProvider, so the list stays as it is under the task. */
function TasksSection() {
  return (
    <TasksProvider>
      <TasksStack.Navigator screenOptions={useScreenOptions()}>
        <TasksStack.Screen name="TaskList" component={Tasks} />
        <TasksStack.Screen name="Task" component={Task} options={overList} />
      </TasksStack.Navigator>
    </TasksProvider>
  );
}

/** The Journal page with an entry over it, both reading JournalsProvider. */
function JournalSection() {
  return (
    <JournalsProvider>
      <JournalStack.Navigator screenOptions={useScreenOptions()}>
        <JournalStack.Screen name="EntryList" component={Journal} />
        <JournalStack.Screen name="Entry" component={Entry} options={overList} />
      </JournalStack.Navigator>
    </JournalsProvider>
  );
}

function useScreenOptions(): NativeStackNavigationOptions {
  return { headerShown: false, contentStyle: { backgroundColor: useColors().bg } };
}
