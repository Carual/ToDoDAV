import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { LocalDate } from '../../api/ical.ts';
import type { Journal } from '../../api/journals.ts';
import { ChevronDownIcon, HashIcon, LayersIcon, PlusIcon } from '../../components/controls/icons.tsx';
import { JournalItem } from '../../components/journal/JournalItem.tsx';
import { JournalModal } from '../../components/journal/JournalModal.tsx';
import { Select } from '../../components/controls/Select.tsx';
import { TopBar } from '../../components/TopBar.tsx';
import { Button, IconButton } from '../../components/controls/ui.tsx';
import { describeDay } from '../../lib/format.ts';
import { ALL, useJournals } from '../../state/journalsContext.tsx';
import { todayDate } from '../../lib/repeat.ts';
import { useColors, type Colors } from '../../theme.ts';
import { readSetting, saveSetting } from '../../lib/viewSettings.ts';

const SHOW_NOTES_KEY = 'tododav.showNotes';
/** Below this width the layout is the phone one: narrower margins and time column. */
const NARROW = 640;

/** Within a day: all-day entries first, then by time, earliest first, as a diary reads. */
function compareInDay(a: Journal, b: Journal): number {
  const timeA = a.start?.time ?? '';
  const timeB = b.start?.time ?? '';
  return timeA < timeB ? -1 : timeA > timeB ? 1 : a.summary.localeCompare(b.summary);
}

/** Notes, most recently changed first. */
function compareNotes(a: Journal, b: Journal): number {
  const changed = (j: Journal) => (j.lastModified ?? j.created)?.getTime() ?? 0;
  return changed(b) - changed(a) || a.summary.localeCompare(b.summary);
}

/** Dated entries by day, newest day first. */
function byDay(entries: Journal[]): { date: string; entries: Journal[] }[] {
  const days = new Map<string, Journal[]>();
  for (const entry of entries) {
    const date = entry.start!.date;
    days.set(date, [...(days.get(date) ?? []), entry]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({ date, entries: list.sort(compareInDay) }));
}

/** What the page shows, one entry per line. */
type Item =
  | { kind: 'newEntry' }
  | { kind: 'noEntries' }
  | { kind: 'day'; date: string; count: number }
  | { kind: 'entry'; journal: Journal }
  | { kind: 'notesHeader'; count: number }
  | { kind: 'note'; journal: Journal }
  | { kind: 'addNote' };

export default function JournalScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const narrow = useWindowDimensions().width < NARROW;
  const {
    calendars,
    selected,
    allView,
    calendar,
    canShowAll,
    selectCalendar,
    list,
    calendarOf,
    createEntry,
    createJournal,
    creatingJournal,
    newEntryCalendar,
    openEntry,
  } = useJournals();
  const hasJournals = calendars.length > 0;

  const [showNotes, setShowNotes] = useState(() => readSetting(SHOW_NOTES_KEY) !== 'false');
  const [refreshing, setRefreshing] = useState(false);
  /** The modal for a new entry, with its date (none: a note). */
  const [creating, setCreating] = useState<{ start?: LocalDate } | null>(null);
  const newEntry = () => setCreating({ start: todayDate() });

  function toggleShowNotes() {
    setShowNotes(!showNotes);
    saveSetting(SHOW_NOTES_KEY, String(!showNotes));
  }

  async function refresh() {
    setRefreshing(true);
    await list.reload();
    setRefreshing(false);
  }

  // "Q" opens a new entry on the web, as it opens a new task on the tasks page (not while typing or in a dialog).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key.toLowerCase() !== 'q' || event.ctrlKey || event.metaKey || event.altKey || typing) return;
      if (creating || !hasJournals || document.querySelector('[aria-modal="true"], [role="dialog"]')) return;
      event.preventDefault();
      setCreating({ start: todayDate() });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [creating, hasJournals]);

  const days = byDay(list.journals.filter((j) => j.start));
  const notes = list.journals.filter((j) => !j.start).sort(compareNotes);

  const items: Item[] = [
    { kind: 'newEntry' },
    ...(days.length === 0 ? [{ kind: 'noEntries' as const }] : []),
    ...days.flatMap(({ date, entries }): Item[] => [
      { kind: 'day', date, count: entries.length },
      ...entries.map((journal): Item => ({ kind: 'entry', journal })),
    ]),
    { kind: 'notesHeader', count: notes.length },
    ...(showNotes ? [...notes.map((journal): Item => ({ kind: 'note', journal })), { kind: 'addNote' as const }] : []),
  ];

  const gutter = narrow ? { paddingHorizontal: 16 } : { paddingHorizontal: 55 };
  const timeWidth = narrow ? 52 : 64;

  function addRow(label: string, onPress: () => void) {
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

  function renderItem({ item }: { item: Item }) {
    switch (item.kind) {
      case 'newEntry':
        return addRow('New entry', newEntry);
      case 'noEntries':
        return (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No entries yet</Text>
            <Text style={styles.emptyText}>Entries {allView ? 'in your journals' : 'in this journal'} show here, by day.</Text>
          </View>
        );
      case 'day':
        return (
          <View style={styles.dayHeading} role="heading">
            <Text style={styles.dayTitle}>{describeDay(item.date)}</Text>
            <Text style={styles.count}>{item.count}</Text>
          </View>
        );
      case 'entry':
      case 'note':
        return (
          <JournalItem
            journal={item.journal}
            project={allView ? calendarOf(item.journal) : undefined}
            timeWidth={timeWidth}
            onOpen={openEntry}
          />
        );
      case 'notesHeader':
        return (
          <Pressable role="button" aria-expanded={showNotes} onPress={toggleShowNotes} style={styles.notesToggle}>
            <View style={!showNotes && styles.rotated}>
              <ChevronDownIcon color={colors.textTertiary} />
            </View>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text style={styles.count}>{item.count}</Text>
          </Pressable>
        );
      case 'addNote':
        return addRow('Add note', () => setCreating({}));
    }
  }

  const header = (
    <View style={styles.viewHeader}>
      <Text style={styles.viewTitle} role="heading">
        {calendar?.name ?? 'Journal'}
      </Text>
      <View style={styles.viewActions}>
        {canShowAll && (
          <Select
            quiet
            aria-label="Journal"
            value={selected ?? ALL}
            onChange={selectCalendar}
            style={styles.calendarSelect}
            options={[
              { value: ALL, label: 'All', icon: <LayersIcon color={colors.textSecondary} /> },
              ...calendars.map((c) => ({ value: c.href, label: c.name, icon: <HashIcon color={c.color ?? colors.textSecondary} /> })),
            ]}
          />
        )}
        <IconButton label="New entry" filled size={30} onPress={newEntry}>
          <PlusIcon color={colors.accentText} size={16} />
        </IconButton>
      </View>
    </View>
  );

  let content;
  if (!hasJournals) {
    content = (
      <View style={[styles.empty, gutter]}>
        <Text style={styles.emptyTitle}>No journals found</Text>
        <Text style={styles.emptyText}>None of your calendars takes journal entries (VJOURNAL). Create one to start writing.</Text>
        {creatingJournal ? (
          <ActivityIndicator color={colors.accent} aria-label="Creating the journal" />
        ) : (
          <Button label="Create journal" variant="primary" onPress={() => void createJournal()} />
        )}
      </View>
    );
  } else if (list.loadError && !list.loaded) {
    content = (
      <View style={[styles.column, gutter]}>
        {header}
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.p1 }]}>{list.loadError}</Text>
          <Button label="Try again" onPress={() => void list.reload()} />
        </View>
      </View>
    );
  } else if (!list.loaded) {
    content = (
      <View style={[styles.column, gutter]}>
        {header}
        <ActivityIndicator style={styles.loading} color={colors.textTertiary} aria-label="Loading the journal" />
      </View>
    );
  } else {
    content = (
      <FlatList
        data={items}
        keyExtractor={(item) =>
          item.kind === 'entry' || item.kind === 'note' ? item.journal.href : item.kind === 'day' ? `day ${item.date}` : item.kind
        }
        renderItem={renderItem}
        ListHeaderComponent={header}
        contentContainerStyle={[styles.column, gutter, styles.listEnd]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.accent]} />}
      />
    );
  }

  return (
    <SafeAreaView style={styles.page} edges={['left', 'right']}>
      <TopBar section="journal" />
      {content}

      {creating && newEntryCalendar && (
        <JournalModal
          guard="self"
          calendar={newEntryCalendar}
          calendars={calendars}
          initialStart={creating.start}
          onClose={() => setCreating(null)}
          onSave={createEntry}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    column: { width: '100%', maxWidth: 800, alignSelf: 'center', paddingTop: 24 },
    listEnd: { paddingBottom: 96 },
    viewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
    viewTitle: { flexShrink: 1, fontSize: 26, lineHeight: 35, fontWeight: '700', color: colors.text },
    viewActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
    calendarSelect: { maxWidth: 220 },
    loading: { paddingVertical: 48 },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    addIcon: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    addText: { fontSize: 14, lineHeight: 21, color: colors.textTertiary },
    empty: { alignItems: 'center', paddingVertical: 64 },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
    emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
    dayHeading: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 6,
      marginTop: 20,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    dayTitle: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: colors.text },
    count: { fontSize: 14, color: colors.textTertiary },
    notesToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 24,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    rotated: { transform: [{ rotate: '-90deg' }] },
    notesTitle: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: colors.text },
  });
