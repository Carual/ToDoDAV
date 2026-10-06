import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * Whether this build has the widget's native code: not in Expo Go, whose fixed set of native modules lacks it (and
 * where merely loading react-native-android-widget throws). The library is only required once this is known.
 */
export const widgetsAvailable = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
