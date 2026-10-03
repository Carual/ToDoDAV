import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import type { LocalDate } from '../api/ical.ts';
import type { Journal as JournalEntry } from '../api/journals.ts';
import { Button } from '../components/controls/ui.tsx';
import { JournalItem } from '../components/journal/JournalItem.tsx';
import { JournalModal } from '../components/journal/JournalModal.tsx';
import { AddRow, EmptyState, ListPage, PageHeader, SectionToggle, useFoldSetting } from '../components/ListPage.tsx';
import { ShareModal } from '../components/ShareModal.tsx';
import { describeDay } from '../lib/format.ts';
import { todayDate } from '../lib/repeat.ts';
import { useJournals } from '../state/journalsContext.tsx';
import { useLoggedIn } from '../state/session.tsx';
import { useColors, type Colors } from '../theme.ts';

/** Below this width the layout is the phone one: narrower margins and time column. */
const NARROW = 640;

/** Within a day: all-day entries first, then by time, earliest first, as a diary reads. */
function compareInDay(a: JournalEntry, b: JournalEntry): number {
  const timeA = a.start?.time ?? '';
  const timeB = b.start?.time ?? '';
  return timeA < timeB ? -1 : timeA > timeB ? 1 : a.summary.localeCompare(b.summary);
}

/** Notes, most recently changed first. */
function compareNotes(a: JournalEntry, b: JournalEntry): number {
  const changed = (j: JournalEntry) => (j.lastModified ?? j.created)?.getTime() ?? 0;
  return changed(b) - changed(a) || a.summary.localeCompare(b.summary);
}

/** Dated entries by day, newest day first. */
function byDay(entries: JournalEntry[]): { date: string; entries: JournalEntry[] }[] {
  const days = new Map<string, JournalEntry[]>();
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
  | { kind: 'entry'; journal: JournalEntry }
  | { kind: 'notesHeader'; count: number }
  | { kind: 'note'; journal: JournalEntry }
  | { kind: 'addNote' };

export function Journal() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const narrow = useWindowDimensions().width < NARROW;
  const journals = useJournals();
  const { calendars, allView, calendar, list, calendarOf, openEntry } = journals;
  const { client, config } = useLoggedIn();
  const hasJournals = calendars.length > 0;

  const [showNotes, toggleShowNotes] = useFoldSetting('tododav.showNotes', true);
  const [sharing, setSharing] = useState(false);
  /** The modal for a new entry, with its date (none: a note). */
  const [creating, setCreating] = useState<{ start?: LocalDate } | null>(null);
  const newEntry = () => setCreating({ start: todayDate() });

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

  const timeWidth = narrow ? 52 : 64;

  function renderItem({ item }: { item: Item }) {
    switch (item.kind) {
      case 'newEntry':
        return <AddRow label="New entry" onPress={newEntry} />;
      case 'noEntries':
        return (
          <EmptyState
            title="No entries yet"
            text={`Entries ${allView ? 'in your journals' : 'in this journal'} show here, by day.`}
          />
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
        return <SectionToggle title="Notes" count={item.count} open={showNotes} onToggle={toggleShowNotes} />;
      case 'addNote':
        return <AddRow label="Add note" onPress={() => setCreating({})} />;
    }
  }

  return (
    <ListPage
      section="journal"
      noCalendars={
        !hasJournals && (
          <EmptyState
            title="No journals found"
            text="None of your calendars takes journal entries (VJOURNAL). Create one to start writing."
          >
            {journals.creatingJournal ? (
              <ActivityIndicator color={colors.accent} aria-label="Creating the journal" />
            ) : (
              <Button label="Create journal" variant="primary" onPress={() => void journals.createJournal()} />
            )}
          </EmptyState>
        )
      }
      header={
        <PageHeader
          allTitle="Journal"
          choice={journals}
          selectLabel="Journal"
          onShare={config.feed && (() => setSharing(true))}
          addLabel="New entry"
          onAdd={newEntry}
        />
      }
      list={list}
      loadingLabel="Loading the journal"
      items={items}
      keyOf={(item) =>
        item.kind === 'entry' || item.kind === 'note' ? item.journal.href : item.kind === 'day' ? `day ${item.date}` : item.kind
      }
      renderItem={renderItem}
      gutter={{ paddingHorizontal: narrow ? 16 : 55 }}
      onQuickAdd={hasJournals ? newEntry : undefined}
    >
      {creating && journals.newEntryCalendar && (
        <JournalModal
          guard="self"
          calendar={journals.newEntryCalendar}
          calendars={calendars}
          initialStart={creating.start}
          onClose={() => setCreating(null)}
          onSave={journals.createEntry}
        />
      )}
      {sharing && calendar && config.feed && (
        <ShareModal
          client={client}
          calendar={calendar}
          token={config.feed.token}
          section="journal"
          onClose={() => setSharing(false)}
        />
      )}
    </ListPage>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
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
  });
