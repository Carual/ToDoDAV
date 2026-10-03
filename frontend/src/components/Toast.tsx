import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '../theme.ts';

export interface ToastMessage {
  message: string;
  /** A button in the toast, such as Undo or Retry. */
  action?: { label: string; run: () => void };
}

/** The message at the bottom left after a change, with its Undo or Retry. */
export function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      role="status"
      aria-live="polite"
      style={[styles.toast, { backgroundColor: colors.toastBg, bottom: insets.bottom + 16 }]}
    >
      <Text style={[styles.message, { color: colors.toastText }]}>{toast.message}</Text>
      {toast.action && (
        <Pressable
          role="button"
          hitSlop={8}
          onPress={() => {
            toast.action?.run();
            onDismiss();
          }}
        >
          <Text style={[styles.action, { color: colors.toastAction }]}>{toast.action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    maxWidth: 480,
    marginRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
  },
  message: { fontSize: 13, flexShrink: 1 },
  action: { fontSize: 13, fontWeight: '600' },
});
