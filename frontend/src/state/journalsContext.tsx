import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createContext, useContext, useState, type ReactNode } from 'react';

import type { Calendar } from '../api/caldav.ts';
import type { Journal, JournalEdits } from '../api/journals.ts';
import { useToast } from '../components/controls/Toast.tsx';
import type { RootParams } from '../navigation.tsx';
import { useCalendarChoice } from './calendarChoice.ts';
import { useLoggedIn } from './session.tsx';
import { useJournalList } from './useJournalList.ts';

/**
 * Everything about the journal entries on screen, shared by the Journal page (/journal) and the entry on top of it
 * (/journal/<uid>), as frontend-react's JournalPage held it.
 */
function useJournalsState() {
  const navigation = useNavigation<NativeStackNavigationProp<RootParams>>();
  const { client, journals: calendars, signOut, setJournals } = useLoggedIn();
  const choice = useCalendarChoice('tododav.journalCalendar', calendars);
  const { calendar, selectCalendar } = choice;
  const showToast = useToast();

  const list = useJournalList({
    client,
    calendarHrefs: choice.shownHrefs,
    onLogout: signOut,
    onWriteError: ({ message, retry }) => showToast({ message, action: retry && { label: 'Retry', run: retry } }),
  });
  const calendarOf = (journal: Journal): Calendar | undefined => calendars.find((c) => c.href === list.listOf(journal));

  function deleteEntry(journal: Journal) {
    const listHref = list.listOf(journal);
    if (!listHref) return;
    list.delete(journal.href);
    showToast({
      message: journal.start ? 'Entry deleted' : 'Note deleted',
      action: { label: 'Undo', run: () => list.undelete(listHref, journal) },
    });
  }

  const [creatingJournal, setCreatingJournal] = useState(false);

  /** A first journal (VJOURNAL only) for an account without any. */
  async function createJournal() {
    setCreatingJournal(true);
    try {
      const created = await client.createCalendar('Journal', undefined, 'VJOURNAL');
      setJournals([...calendars, created]);
      selectCalendar(created.href);
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : 'Could not create the journal.' });
    } finally {
      setCreatingJournal(false);
    }
  }

  return {
    ...choice,
    showToast,
    list,
    calendarOf,
    deleteEntry,
    createEntry: (edits: JournalEdits, calendarHref: string) => list.create(calendarHref, edits),
    saveEntry: (journal: Journal, edits: JournalEdits) => list.edit(journal.href, edits),
    createJournal,
    creatingJournal,
    /** Where a new entry goes unless the modal picks another journal. */
    newEntryCalendar: calendar ?? calendars[0],
    // Through the root navigator, as openTask in tasksContext.
    openEntry: (journal: Journal) => navigation.navigate('Journal', { screen: 'Entry', params: { uid: journal.uid } }),
  };
}

type JournalsState = ReturnType<typeof useJournalsState>;

const JournalsContext = createContext<JournalsState | null>(null);

export function JournalsProvider({ children }: { children: ReactNode }) {
  const state = useJournalsState();
  return <JournalsContext.Provider value={state}>{children}</JournalsContext.Provider>;
}

export function useJournals(): JournalsState {
  const state = useContext(JournalsContext);
  if (!state) throw new Error('useJournals must be used inside JournalsProvider.');
  return state;
}
