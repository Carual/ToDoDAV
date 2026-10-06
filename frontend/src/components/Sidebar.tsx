import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLoggedIn } from '../state/session.tsx';
import { useColors, fs, type Colors } from '../theme.ts';
import { CloseIcon, GearIcon, LogOutIcon } from './controls/icons.tsx';
import { IconButton } from './controls/ui.tsx';

const WIDTH = 280;

interface Props {
  onClose: () => void;
  /** Opens the settings; without it, the row is left out (the settings are about tasks). */
  onSettings?: () => void;
}

/** The account, Settings and Log out, in a panel that slides over the page from the left. */
export function Sidebar({ onClose, onSettings }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { client, signOut } = useLoggedIn();
  return (
    // onRequestClose: Android's back button and Escape on the web close it.
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} aria-label="Close" />
        <View
          role="dialog"
          aria-modal
          aria-label="Menu"
          style={[
            styles.panel,
            { width: Math.min(WIDTH, window.width - 48), paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.account}>
              <View style={styles.avatar} aria-hidden>
                <Text style={styles.avatarText}>{client.username.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text style={styles.accountName} numberOfLines={1}>
                {client.username}
              </Text>
            </View>
            <IconButton label="Close" onPress={onClose}>
              <CloseIcon color={colors.textSecondary} />
            </IconButton>
          </View>
          {onSettings && (
            <Item
              label="Settings"
              icon={<GearIcon color={colors.textSecondary} size={20} />}
              onPress={() => {
                onClose();
                onSettings();
              }}
            />
          )}
          <Item label="Log out" icon={<LogOutIcon color={colors.textSecondary} size={20} />} onPress={signOut} />
        </View>
      </View>
    </Modal>
  );
}

function Item({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <Pressable
      role="button"
      onPress={onPress}
      style={({ pressed, hovered }) => [styles.item, (pressed || hovered) && { backgroundColor: colors.bgHover }]}
    >
      {icon}
      <Text style={styles.itemText}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)' },
    panel: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      paddingHorizontal: 8,
      gap: 2,
      backgroundColor: colors.bgSoft,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 8,
      paddingBottom: 12,
    },
    account: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
    avatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.p2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: '#fff', fontSize: fs(12), fontWeight: '700' },
    accountName: { color: colors.text, fontWeight: '600', fontSize: fs(14), flexShrink: 1 },
    item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 5 },
    itemText: { color: colors.text, fontSize: fs(14) },
  });
