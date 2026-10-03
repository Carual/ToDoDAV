import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColors } from '../../theme.ts';
import { Button } from './ui.tsx';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  /** Leaves the confirm button shown but unusable (the message should say why). */
  confirmDisabled?: boolean;
  /** The confirm button in red: it removes something. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** A third choice between Cancel and the confirm button, such as "Discard" next to "Save". */
  alternative?: { label: string; onPress: () => void };
}

/** A small in-app replacement for window.confirm and Alert, drawn above whatever asked. */
export function ConfirmDialog({ title, message, confirmLabel, confirmDisabled = false, danger, onConfirm, onCancel, alternative }: Props) {
  const colors = useColors();
  return (
    // onRequestClose: Android's back button and Escape on the web cancel.
    <Modal transparent visible animationType="fade" onRequestClose={onCancel} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} aria-label="Cancel" />
        <View role="alertdialog" aria-modal aria-label={title} style={[styles.dialog, { backgroundColor: colors.bg }]}>
          <Text style={[styles.title, { color: colors.text }]} role="heading">
            {title}
          </Text>
          <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
          <View style={styles.footer}>
            <Button label="Cancel" onPress={onCancel} />
            {alternative && <Button label={alternative.label} onPress={alternative.onPress} />}
            <Button label={confirmLabel} variant={danger ? 'danger' : 'primary'} onPress={onConfirm} disabled={confirmDisabled} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  dialog: {
    width: '100%',
    maxWidth: 450,
    borderRadius: 10,
    padding: 20,
    boxShadow: '0 15px 50px rgba(0, 0, 0, 0.35)',
  },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  message: { fontSize: 14, lineHeight: 21 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 20 },
});
