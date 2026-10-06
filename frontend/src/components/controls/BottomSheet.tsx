import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors, fs, type Colors } from '../../theme.ts';

interface Props {
  /** The title, also what the sheet is for assistive technologies. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A panel sliding up from the bottom of the screen, for one detail of a task on a phone (its date, priority...), where
 * the thumb is. Its changes apply at once; Done, the backdrop and Android's back button only close it.
 */
export function BottomSheet({ label, onClose, children }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  // Only the panel slides up: the Modal's own "slide" would carry the dimmed backdrop up with it.
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(shown, {
      toValue: 1,
      duration: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [shown]);
  const translateY = shown.interpolate({ inputRange: [0, 1], outputRange: [height, 0] });

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} aria-label="Close" />
      {/* Android too: edge-to-edge no longer resizes the window for the keyboard, so a field in the sheet would sit under it. */}
      <KeyboardAvoidingView style={styles.frame} behavior="padding" pointerEvents="box-none">
        <Animated.View
          role="dialog"
          aria-modal
          aria-label={label}
          style={[styles.sheet, { paddingBottom: insets.bottom + 12, transform: [{ translateY }] }]}
        >
          <View style={styles.handle} aria-hidden />
          <View style={styles.header}>
            <Text style={styles.title} role="heading">
              {label}
            </Text>
            <Pressable role="button" hitSlop={12} onPress={onClose} style={styles.done}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: { backgroundColor: 'rgba(0, 0, 0, 0.4)' },
    frame: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      maxHeight: '85%',
      backgroundColor: colors.bg,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      boxShadow: '0 -4px 24px rgba(0, 0, 0, 0.2)',
    },
    handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginTop: 8, backgroundColor: colors.border },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 4,
    },
    title: { fontSize: fs(16), fontWeight: '700', color: colors.text },
    done: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 4 },
    doneText: { fontSize: fs(15), fontWeight: '600', color: colors.accent },
    body: { flexGrow: 0 },
    bodyContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 12 },
  });
