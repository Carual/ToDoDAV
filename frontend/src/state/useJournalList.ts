import { applyJournalEdits, newJournalIcs, parseJournal, type Journal, type JournalEdits } from '../api/journals.ts';
import { useCalendarObjects, type ListOptions, type ObjectKind } from './useCalendarObjects.ts';

const JOURNALS: ObjectKind<Journal> = {
  list: (client, href) => client.listJournals(href),
  parse: parseJournal,
  noun: 'entry',
};

/** The journal entries and notes of every journal seen so far, changed optimistically (see useCalendarObjects). */
export function useJournalList(options: ListOptions) {
  const list = useCalendarObjects(JOURNALS, options);
  const { client } = options;
  const { change, insert } = list;

  return {
    journals: list.items,
    /** The journal an entry on screen is in. */
    listOf: list.listOf,
    loaded: list.loaded,
    fetched: list.fetched,
    loadError: list.loadError,
    reload: list.reload,
    create: (calendarHref: string, edits: JournalEdits) => {
      const { uid, ics } = newJournalIcs(edits);
      insert(calendarHref, client.objectHref(calendarHref, uid), ics);
    },
    edit: (href: string, edits: JournalEdits) => change(href, (journal) => applyJournalEdits(journal, edits)),
    delete: list.destroy,
    /** Stores a deleted entry again, exactly as it was (Undo), under its old href. */
    undelete: (calendarHref: string, journal: Journal) => insert(calendarHref, journal.href, journal.ics),
    locate: list.locate,
  };
}
