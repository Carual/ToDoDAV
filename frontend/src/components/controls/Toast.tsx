import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors, fs } from '../../theme.ts';

export interface ToastMessage {
  message: string;
  /** A button in the toast, such as Undo or Retry. */
  action?: { label: string; run: () => void };
}

const ShowToast = createContext<((toast: ToastMessage) => void) | null>(null);

/** Shows a toast over everything inside it for 5 seconds (the next one replaces it). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function showToast(next: ToastMessage) {
    clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), 5000);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ShowToast.Provider value={showToast}>
      <View style={styles.fill}>
        {children}
        {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
      </View>
    </ShowToast.Provider>
  );
}

export function useToast() {
  const showToast = useContext(ShowToast);
  if (!showToast) throw new Error('useToast must be used inside ToastProvider.');
  return showToast;
}

/** The message at the bottom left after a change, with its Undo or Retry. */
function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
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
  fill: { flex: 1 },
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
  message: { fontSize: fs(13), flexShrink: 1 },
  action: { fontSize: fs(13), fontWeight: '600' },
});
