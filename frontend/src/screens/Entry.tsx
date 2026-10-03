import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { JournalModal } from '../components/journal/JournalModal.tsx';
import type { JournalParams } from '../navigation.tsx';
import { useFindElsewhere } from '../state/calendarChoice.ts';
import { useJournals } from '../state/journalsContext.tsx';

/** /journal/<uid>: the entry's modal over the Journal page. */
export function Entry({ navigation, route }: NativeStackScreenProps<JournalParams, 'Entry'>) {
  const { uid } = route.params;
  const journals = useJournals();
  const { list, calendarOf } = journals;
  const journal = list.journals.find((j) => j.uid === uid);
  const calendar = journal && calendarOf(journal);

  // Back to the page under it (as for tasks).
  const close = () => navigation.popTo('EntryList');

  useFindElsewhere(uid, journal === undefined && list.fetched, journals, list.locate, () => {
    journals.showToast({ message: 'Entry not found' });
    close();
  });

  if (!journal || !calendar) return null;
  return (
    <JournalModal
      // Remount only when the content changes (a reload or a failed save), not when a save just confirms it.
      key={`${journal.href} ${journal.ics}`}
      guard="navigation"
      journal={journal}
      calendar={calendar}
      onClose={close}
      onSave={(edits) => journals.saveEntry(journal, edits)}
      onDelete={journals.deleteEntry}
    />
  );
}
