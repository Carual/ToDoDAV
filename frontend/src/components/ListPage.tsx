import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { readSetting, saveSetting } from '../lib/viewSettings.ts';
import { ALL, type CalendarChoice } from '../state/calendarChoice.ts';
import { useColors, type Colors } from '../theme.ts';
import { ChevronDownIcon, HashIcon, LayersIcon, PlusIcon, ShareIcon } from './controls/icons.tsx';
import { Select } from './controls/Select.tsx';
import { Button, IconButton } from './controls/ui.tsx';
import { TopBar } from './TopBar.tsx';

// The frame the Tasks and Journal pages share: the top bar, a header, and the list with its loading and error states.

interface ListPageProps<Item> {
  section: 'tasks' | 'journal';
  onSettings?: () => void;
  /** Shown instead of the whole page when there is no calendar to show. */
  noCalendars?: ReactNode;
  header: ReactNode;
  list: { loaded: boolean; loadError: string | null; reload: () => Promise<unknown> };
  loadingLabel: string;
  items: Item[];
  keyOf: (item: Item) => string;
  renderItem: ListRenderItem<Item>;
  /** Side margins of the column. */
  gutter: StyleProp<ViewStyle>;
  /** The "Q" key on the web, like Todoist's quick add; undefined when there's nothing to add to. */
  onQuickAdd?: () => void;
  /** The dialogs the page opens. */
  children?: ReactNode;
}

export function ListPage<Item>({
  section,
  onSettings,
  noCalendars,
  header,
  list,
  loadingLabel,
  items,
  keyOf,
  renderItem,
  gutter,
  onQuickAdd,
  children,
}: ListPageProps<Item>) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    await list.reload();
    setRefreshing(false);
  }

  // Tasks and Journal stay as they were left while the other is on screen; coming back to one reads the server
  // again, for changes made elsewhere meanwhile (the web has no pull to refresh). Not when a task or entry over the
  // page closes: that only refocuses the page, not its section.
  const navigation = useNavigation();
  const latestList = useRef(list);
  latestList.current = list;
  useEffect(
    () =>
      navigation.getParent()?.addListener('focus', () => {
        if (latestList.current.loaded) void latestList.current.reload();
      }),
    [navigation],
  );

  // Not while typing, and not with a dialog of any kind (the task page, a picker) on top: the key is theirs then.
  useEffect(() => {
    if (Platform.OS !== 'web' || !onQuickAdd) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key.toLowerCase() !== 'q' || event.ctrlKey || event.metaKey || event.altKey || typing) return;
      if (document.querySelector('[aria-modal="true"], [role="dialog"]')) return;
      event.preventDefault();
      onQuickAdd();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  let content;
  if (noCalendars) {
    content = <View style={gutter}>{noCalendars}</View>;
  } else if (list.loadError && !list.loaded) {
    content = (
      <View style={[styles.column, gutter]}>
        {header}
        <EmptyState text={list.loadError} error>
          <Button label="Try again" onPress={() => void list.reload()} />
        </EmptyState>
      </View>
    );
  } else if (!list.loaded) {
    content = (
      <View style={[styles.column, gutter]}>
        {header}
        <ActivityIndicator style={styles.loading} color={colors.textTertiary} aria-label={loadingLabel} />
      </View>
    );
  } else {
    content = (
      <FlatList
        data={items}
        keyExtractor={keyOf}
        renderItem={renderItem}
        ListHeaderComponent={
          <>
            {header}
            {/* A reload that failed over a list already shown: the list stays, but it may be out of date. */}
            {list.loadError && (
              <View style={styles.errorBar} role="alert">
                <Text style={styles.errorText}>{list.loadError}</Text>
                <Button label="Try again" onPress={() => void list.reload()} />
              </View>
            )}
          </>
        }
        contentContainerStyle={[styles.column, gutter, styles.listEnd]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.accent]} />}
      />
    );
  }

  return (
    <SafeAreaView style={styles.page} edges={['left', 'right']}>
      <TopBar section={section} onSettings={onSettings} />
      {content}
      {children}
    </SafeAreaView>
  );
}

interface PageHeaderProps {
  /** The title in the "All" view. */
  allTitle: string;
  choice: CalendarChoice;
  /** What the calendar selector picks ("Task list", "Journal"). */
  selectLabel: string;
  /** Before the selector (the filters button). */
  actions?: ReactNode;
  /** The feed's share button, only for a single calendar and when the server has feeds. */
  onShare?: () => void;
  addLabel: string;
  onAdd: () => void;
}

/** The calendar's name, with the selector, share and "+" buttons at the right. */
export function PageHeader({ allTitle, choice, selectLabel, actions, onShare, addLabel, onAdd }: PageHeaderProps) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { calendars, calendar, canShowAll, selected, selectCalendar } = choice;
  return (
    <View style={styles.header}>
      <Text style={styles.title} role="heading">
        {calendar?.name ?? allTitle}
      </Text>
      <View style={styles.actions}>
        {actions}
        {canShowAll && (
          <Select
            quiet
            aria-label={selectLabel}
            value={selected ?? ALL}
            onChange={selectCalendar}
            style={styles.select}
            options={[
              { value: ALL, label: 'All', icon: <LayersIcon color={colors.textSecondary} /> },
              ...calendars.map((c) => ({ value: c.href, label: c.name, icon: <HashIcon color={c.color ?? colors.textSecondary} /> })),
            ]}
          />
        )}
        {onShare && calendar && (
          <IconButton label="Add to Google Calendar" onPress={onShare}>
            <ShareIcon color={colors.textSecondary} size={20} />
          </IconButton>
        )}
        {/* The same as the "+ Add" row in the list, reachable without scrolling past a long one. */}
        <IconButton label={addLabel} filled size={30} onPress={onAdd}>
          <PlusIcon color={colors.accentText} size={16} />
        </IconButton>
      </View>
    </View>
  );
}

/** A "+ Add task" row in the list. */
export function AddRow({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <Pressable role="button" onPress={onPress} style={styles.addRow}>
      {({ pressed, hovered }) => (
        <>
          <View style={[styles.addIcon, (pressed || hovered) && { backgroundColor: colors.accent }]}>
            <PlusIcon color={pressed || hovered ? '#fff' : colors.accent} />
          </View>
          <Text style={[styles.addText, (pressed || hovered) && { color: colors.accent }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/** The heading of a part of the list that can be folded (Completed, Notes). */
export function SectionToggle({ title, count, open, onToggle }: { title: string; count: number; open: boolean; onToggle: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <Pressable role="button" aria-expanded={open} onPress={onToggle} style={styles.sectionToggle}>
      <View style={!open && styles.rotated}>
        <ChevronDownIcon color={colors.textTertiary} />
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.count}>{count}</Text>
    </Pressable>
  );
}

/** A centered message where the list would be ("All clear", an error). */
export function EmptyState({ title, text, error, children }: { title?: string; text: string; error?: boolean; children?: ReactNode }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.empty}>
      {title && <Text style={styles.emptyTitle}>{title}</Text>}
      <Text style={[styles.emptyText, error && { color: colors.p1 }]}>{text}</Text>
      {children}
    </View>
  );
}

/** A setting remembered in localStorage that folds or unfolds part of the list. */
export function useFoldSetting(key: string, initial: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    const saved = readSetting(key);
    return saved === null ? initial : saved === 'true';
  });
  return [
    open,
    () => {
      setOpen(!open);
      saveSetting(key, String(!open));
    },
  ];
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    column: { width: '100%', maxWidth: 800, alignSelf: 'center', paddingTop: 24 },
    listEnd: { paddingBottom: 96 },
    loading: { paddingVertical: 48 },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
      paddingVertical: 4,
      paddingLeft: 10,
      paddingRight: 4,
      borderRadius: 5,
      backgroundColor: colors.bgSoft,
    },
    errorText: { flex: 1, fontSize: 13, color: colors.p1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
    title: { flexShrink: 1, fontSize: 26, lineHeight: 35, fontWeight: '700', color: colors.text },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
    select: { maxWidth: 220 },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    addIcon: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    addText: { fontSize: 14, lineHeight: 21, color: colors.textTertiary },
    empty: { alignItems: 'center', paddingVertical: 64 },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
    emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
    sectionToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 24,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    rotated: { transform: [{ rotate: '-90deg' }] },
    sectionTitle: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: colors.text },
    count: { fontSize: 14, color: colors.textTertiary },
  });
