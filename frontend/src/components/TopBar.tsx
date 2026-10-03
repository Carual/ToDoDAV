import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLoggedIn } from '../session.tsx';
import { useColors, type Colors } from '../theme.ts';
import { LogoMark } from './LogoMark.tsx';

const SECTIONS = [
  { name: 'tasks', label: 'Tasks', path: '/tasks' },
  { name: 'journal', label: 'Journal', path: '/journal' },
] as const;

/** Below this width the brand name and the username are left out, so the tabs fit. */
const NARROW = 640;

/** The bar at the top: the brand, Tasks | Journal (real links on the web), and the account with Log out. */
export function TopBar({ section }: { section: 'tasks' | 'journal' }) {
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
            {SECTIONS.map(({ name, label, path }) => {
              const current = section === name;
              return (
                // Link passes its props down to the Pressable, and refuses a style array.
                <Link key={name} href={path} asChild>
                  <Pressable
                    role="tab"
                    aria-selected={current}
                    style={StyleSheet.flatten([styles.tab, current && { borderBottomColor: colors.accent }])}
                  >
                    <Text style={[styles.tabText, { color: current ? colors.text : colors.textSecondary }]}>{label}</Text>
                  </Pressable>
                </Link>
              );
            })}
          </View>
        </View>
        <View style={styles.account}>
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
    brandText: { fontSize: 16, fontWeight: '700', color: colors.text },
    tabs: { flexDirection: 'row', gap: 4 },
    // Plain tabs, the current one underlined in the accent color.
    tab: { justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabText: { fontSize: 14, fontWeight: '600' },
    account: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    avatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.p2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    accountName: { color: colors.text, fontWeight: '600', fontSize: 14 },
    link: { color: colors.link, fontSize: 14 },
  });
