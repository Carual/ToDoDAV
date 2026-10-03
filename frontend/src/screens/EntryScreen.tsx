import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';

import { JournalModal } from '../components/journal/JournalModal.tsx';
import type { JournalParams } from '../navigation.tsx';
import { useJournals } from '../state/journalsContext.tsx';

/** /journal/<uid>: the entry's modal over the Journal page. */
export function EntryScreen({ navigation, route }: NativeStackScreenProps<JournalParams, 'Entry'>) {
  const { uid } = route.params;
  const { list, calendars, calendarOf, allView, selected, selectCalendar, showToast, saveEntry, deleteEntry } = useJournals();
  const journal = list.journals.find((j) => j.uid === uid);
  const calendar = journal && calendarOf(journal);

  // Back to the page under it (as for tasks).
  const close = () => navigation.popTo('EntryList');

  // An entry link can point to another journal (the URL has only the UID): look there and switch to it.
  const missing = journal === undefined && list.fetched;
  const { locate } = list;
  useEffect(() => {
    if (!missing || !uid) return;
    let cancelled = false;
    const others = allView ? [] : calendars.filter((c) => c.href !== selected);
    void locate(uid, others).then((found) => {
      if (cancelled) return;
      if (found) return selectCalendar(found);
      showToast({ message: 'Entry not found' });
      navigation.popTo('EntryList');
    });
    return () => {
      cancelled = true;
    };
  }, [missing, uid]);

  if (!journal || !calendar) return null;
  return (
    <JournalModal
      // Remount only when the content changes (a reload or a failed save), not when a save just confirms it.
      key={`${journal.href} ${journal.ics}`}
      guard="navigation"
      journal={journal}
      calendar={calendar}
      onClose={close}
      onSave={(edits) => saveEntry(journal, edits)}
      onDelete={deleteEntry}
    />
  );
}
