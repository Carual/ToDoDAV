import { useRouter } from 'expo-router';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import type { Calendar } from './api/caldav.ts';
import type { Journal, JournalEdits } from './api/journals.ts';
import type { ToastMessage } from './components/Toast.tsx';
import { useLoggedIn } from './session.tsx';
import { useJournalList } from './useJournalList.ts';
import { readSetting, saveSetting } from './viewSettings.ts';

const SELECTED_KEY = 'tododav.journalCalendar';
/** The "All" view's value where a journal href would go; hrefs start with / or a scheme, so it can't clash. */
export const ALL = 'all';

/**
 * Everything about the journal entries on screen, shared by the Journal page (/journal) and the entry on top of it
 * (/journal/<uid>), as frontend-react's JournalPage held it.
 */
function useJournalsState() {
  const router = useRouter();
  const { client, journals: calendars, signOut, setJournals } = useLoggedIn();

  const canShowAll = calendars.length > 1;
  const [selected, setSelected] = useState(() => {
    const saved = readSetting(SELECTED_KEY);
    if (saved === ALL && canShowAll) return ALL;
    return calendars.find((c) => c.href === saved)?.href ?? (canShowAll ? ALL : calendars[0]?.href);
  });
  const allView = selected === ALL;
  /** The single journal on screen; undefined in the "All" view. */
  const calendar = calendars.find((c) => c.href === selected);
  const shownHrefs = allView ? calendars.map((c) => c.href) : calendar ? [calendar.href] : [];

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function showToast(next: ToastMessage) {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const list = useJournalList({
    client,
    calendarHrefs: shownHrefs,
    onLogout: signOut,
    onWriteError: ({ message, retry }) => showToast({ message, action: retry && { label: 'Retry', run: retry } }),
  });
  const calendarOf = (journal: Journal): Calendar | undefined => calendars.find((c) => c.href === list.listOf(journal));

  function selectCalendar(href: string) {
    setSelected(href);
    saveSetting(SELECTED_KEY, href);
  }

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
    calendars,
    selected,
    allView,
    calendar,
    canShowAll,
    selectCalendar,
    toast,
    showToast,
    dismissToast: () => setToast(null),
    list,
    calendarOf,
    deleteEntry,
    createEntry: (edits: JournalEdits, calendarHref: string) => list.create(calendarHref, edits),
    saveEntry: (journal: Journal, edits: JournalEdits) => list.edit(journal.href, edits),
    createJournal,
    creatingJournal,
    /** Where a new entry goes unless the modal picks another journal. */
    newEntryCalendar: calendar ?? calendars[0],
    openEntry: (journal: Journal) => router.push({ pathname: '/journal/[uid]', params: { uid: journal.uid } }),
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
