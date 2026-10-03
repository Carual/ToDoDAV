import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { JournalModal } from '../../components/journal/JournalModal.tsx';
import { useJournals } from '../../state/journalsContext.tsx';

/** /journal/<uid>: the entry's modal over the Journal page. */
export default function EntryScreen() {
  const router = useRouter();
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const { list, calendars, calendarOf, allView, selected, selectCalendar, showToast, saveEntry, deleteEntry } = useJournals();
  const journal = list.journals.find((j) => j.uid === uid);
  const calendar = journal && calendarOf(journal);

  // Back to the page under it (dismissTo rather than back: see app/tasks/[uid].tsx).
  const close = () => router.dismissTo('/journal');

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
      router.replace('/journal');
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
