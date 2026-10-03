import 'react-native';

// react-native-web also passes `hovered` to Pressable's style and children functions; on Android/iOS it is undefined.
declare module 'react-native' {
  interface PressableStateCallbackType {
    readonly hovered?: boolean;
  }
}
