import { useLinkProps } from '@react-navigation/native';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLoggedIn } from '../state/session.tsx';
import { useColors, fs, type Colors } from '../theme.ts';
import { GearIcon } from './controls/icons.tsx';
import { IconButton } from './controls/ui.tsx';
import { LogoMark } from './LogoMark.tsx';

const SECTIONS = [
  { name: 'tasks', label: 'Tasks', screen: 'Tasks' },
  { name: 'journal', label: 'Journal', screen: 'Journal' },
] as const;

/** Below this width the brand name and the username are left out, so the tabs fit. */
const NARROW = 640;

interface Props {
  section: 'tasks' | 'journal';
  /** Opens the settings; without it, the gear is left out (the settings are about tasks). */
  onSettings?: () => void;
}

/** The bar at the top: the brand, Tasks | Journal (real links on the web), and the account with Log out. */
export function TopBar({ section, onSettings }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const narrow = useWindowDimensions().width < NARROW;
  const { client, signOut } = useLoggedIn();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <View style={styles.topbar}>
        <View style={styles.start}>
          <View style={styles.brand}>
            <LogoMark size={20} />
            {!narrow && <Text style={styles.brandText}>ToDoDAV</Text>}
          </View>
          <View role="tablist" aria-label="Sections" style={styles.tabs}>
            {SECTIONS.map(({ name, label, screen }) => (
              <Tab key={name} label={label} screen={screen} current={section === name} />
            ))}
          </View>
        </View>
        <View style={styles.account}>
          {onSettings && (
            <IconButton label="Settings" onPress={onSettings}>
              <GearIcon color={colors.textSecondary} size={20} />
            </IconButton>
          )}
          <View style={styles.avatar} aria-hidden>
            <Text style={styles.avatarText}>{client.username.slice(0, 1).toUpperCase()}</Text>
          </View>
          {!narrow && <Text style={styles.accountName}>{client.username}</Text>}
          <Pressable role="button" onPress={signOut} hitSlop={8}>
            <Text style={styles.link}>Log out</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

/**
 * A section's tab: a real link on the web (/tasks, /journal), so it can be opened in a new tab. The section keeps one
 * screen (getId in navigation.tsx), so switching brings it back as it was left.
 */
function Tab({ label, screen, current }: { label: string; screen: 'Tasks' | 'Journal'; current: boolean }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { href, onPress } = useLinkProps({ screen });
  // Pressable has no href in React Native's types, but react-native-web renders a View with one as an <a>.
  const link = { href } as object;
  return (
    <Pressable
      {...link}
      onPress={onPress}
      role="tab"
      aria-selected={current}
      style={[styles.tab, current && { borderBottomColor: colors.accent }]}
    >
      <Text style={[styles.tabText, { color: current ? colors.text : colors.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { backgroundColor: colors.bg },
    topbar: {
      flexDirection: 'row',
      alignItems: 'stretch',
      justifyContent: 'space-between',
      height: 48,
      paddingHorizontal: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    start: { flexDirection: 'row', alignItems: 'stretch', gap: 16, minWidth: 0 },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    brandText: { fontSize: fs(16), fontWeight: '700', color: colors.text },
    tabs: { flexDirection: 'row', gap: 4 },
    // Plain tabs, the current one underlined in the accent color.
    tab: { justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabText: { fontSize: fs(14), fontWeight: '600' },
    account: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    avatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.p2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: '#fff', fontSize: fs(12), fontWeight: '700' },
    accountName: { color: colors.text, fontWeight: '600', fontSize: fs(14) },
    link: { color: colors.link, fontSize: fs(14) },
  });
