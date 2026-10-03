import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors, type Colors } from '../../theme.ts';
import { CloseIcon } from './icons.tsx';
import { Button, IconButton } from './ui.tsx';

interface Props {
  /** The title, also what the dialog is for assistive technologies. */
  label: string;
  icon: ReactNode;
  onClose: () => void;
  /** A link at the left of the footer ("Reset to defaults", "Clear filters"). */
  footerAction?: { label: string; onPress: () => void; disabled?: boolean };
  children: ReactNode;
}

/** A small dialog whose changes apply at once (settings, filters), closed with Done, ×, the backdrop or Back. */
export function SmallDialog({ label, icon, onClose, footerAction, children }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  return (
    // onRequestClose: Android's back button and Escape on the web close it.
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.backdrop, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} aria-label="Close" />
        <View role="dialog" aria-modal aria-label={label} style={styles.dialog}>
          <View style={styles.header}>
            <View style={styles.title}>
              {icon}
              <Text style={styles.titleText} role="heading">
                {label}
              </Text>
            </View>
            <IconButton label="Close" onPress={onClose}>
              <CloseIcon color={colors.textSecondary} />
            </IconButton>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          <View style={styles.footer}>
            {footerAction && (
              <Pressable
                role="button"
                hitSlop={8}
                disabled={footerAction.disabled}
                aria-disabled={footerAction.disabled}
                onPress={footerAction.onPress}
                style={footerAction.disabled && styles.disabled}
              >
                <Text style={styles.link}>{footerAction.label}</Text>
              </Pressable>
            )}
            <View style={styles.spacer} />
            <Button label="Done" variant="primary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** A titled part of the dialog. */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      {title && (
        <Text style={styles.sectionTitle} role="heading">
          {title}
        </Text>
      )}
      {children}
    </View>
  );
}

/** A setting's name with its control at the right, the control going under it when there is no room. */
export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

/** Small print under a setting. */
export function Note({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <Text style={[makeStyles(colors).note]}>{children}</Text>;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    dialog: {
      width: '100%',
      maxWidth: 560,
      maxHeight: '100%',
      borderRadius: 10,
      backgroundColor: colors.bg,
      boxShadow: '0 15px 50px rgba(0, 0, 0, 0.35)',
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      paddingLeft: 20,
      paddingRight: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    title: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    titleText: { fontSize: 14, fontWeight: '600', color: colors.text },
    body: { flexShrink: 1 },
    bodyContent: { paddingHorizontal: 20, paddingVertical: 16, gap: 20 },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    spacer: { flex: 1 },
    link: { color: colors.link, fontSize: 14 },
    disabled: { opacity: 0.5 },
    section: { gap: 10 },
    sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    rowLabel: { fontSize: 13, color: colors.text },
    note: { fontSize: 12, lineHeight: 18, color: colors.textTertiary },
  });
