import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import type { Calendar } from '../api/caldav.ts';
import { sameDate, type LocalDate } from '../api/ical.ts';
import type { Journal, JournalEdits, JournalStatus } from '../api/journals.ts';
// No extension: the bundler picks download.native.ts on Android/iOS.
import { download } from '../download';
import { fileName } from '../fileName.ts';
import { describeRepeat } from '../format.ts';
import { hasMarkdown, InlineMarkdown, Markdown, plainText } from '../markdown.tsx';
import { useColors } from '../theme.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { DownloadIcon, RepeatIcon, TrashIcon } from './icons.tsx';
import type { MenuItem } from './Menu.tsx';
import {
  CalendarField,
  DateField,
  DEFAULT_TIME,
  DescriptionInput,
  Details,
  LabelsInput,
  LeaveDialog,
  LocationInput,
  MarkdownView,
  ModalShell,
  SidebarItem,
  UidLine,
  useLeavePrompt,
  useModalStyles,
  type Guard,
} from './modalParts.tsx';
import { Select } from './Select.tsx';
import { SwitchRow } from './ui.tsx';

interface Props {
  /** The entry to show and edit; absent when adding a new one. */
  journal?: Journal;
  /** The entry's journal; for a new entry, the one chosen at first. */
  calendar: Calendar;
  /** The journals a new entry can go in; with more than one, the modal lets the user pick. */
  calendars?: Calendar[];
  /** A new entry's date; none makes it a note. */
  initialStart?: LocalDate;
  /** `navigation` for /journal/<uid>, `self` for a new entry (see modalParts' Guard). */
  guard: Guard;
  onClose: () => void;
  /** Takes the edits and the journal (for a new entry, the one picked); the save runs in the background. */
  onSave: (edits: JournalEdits, calendarHref: string) => void;
  /** Deletes the entry, once the user has confirmed. */
  onDelete?: (journal: Journal) => void;
}

const STATUS_OPTIONS: { value: JournalStatus; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'FINAL', label: 'Final' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/** Room to write: the text starts at a few lines rather than one. */
const TEXT_HEIGHT = 140;

function initialEdits(journal: Journal | undefined, initialStart: LocalDate | undefined): JournalEdits {
  if (!journal) return { summary: '', description: '', start: initialStart, status: 'FINAL', categories: [], location: '' };
  return {
    summary: journal.summary,
    description: journal.description,
    start: journal.start,
    status: journal.status,
    categories: journal.categories,
    location: journal.location ?? '',
  };
}

function sameEdits(a: JournalEdits, b: JournalEdits): boolean {
  return (
    a.summary === b.summary &&
    a.description === b.description &&
    sameDate(a.start, b.start) &&
    a.status === b.status &&
    a.categories.join('\n') === b.categories.join('\n') &&
    a.location === b.location
  );
}

export function JournalModal({ journal, calendar: initialCalendar, calendars = [], initialStart, guard, onClose, onSave, onDelete }: Props) {
  const colors = useColors();
  const shared = useModalStyles();
  const isNew = journal === undefined;
  const [calendar, setCalendar] = useState(initialCalendar);
  const [edits, setEdits] = useState(() => initialEdits(journal, initialStart));
  const [allDay, setAllDay] = useState(() => !(journal ? journal.start : initialStart)?.time);
  // As in the task modal: formatted text that turns into its editor when tapped. A new entry starts with the title.
  const [editing, setEditing] = useState<'summary' | 'description' | null>(isNew ? 'summary' : null);

  const update = (patch: Partial<JournalEdits>) => setEdits((current) => ({ ...current, ...patch }));
  const dirty = !sameEdits(edits, initialEdits(journal, initialStart));
  const problem = !edits.summary.trim() && !edits.description.trim() ? 'The entry needs a title or some text.' : null;
  const canSave = dirty && !problem;
  const leave = useLeavePrompt(guard, dirty, onClose);

  function toggleAllDay(next: boolean) {
    setAllDay(next);
    if (edits.start) update({ start: next ? { date: edits.start.date } : { ...edits.start, time: edits.start.time ?? DEFAULT_TIME } });
  }

  function save() {
    if (!canSave) return;
    onSave(edits, calendar.href);
    leave.leaveNow();
  }

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const menuItems: MenuItem[] = [];
  if (journal) {
    // The file as stored on the server (repeats and overrides included), not the unsaved edits.
    menuItems.push({
      label: 'Download as .ics',
      icon: (color) => <DownloadIcon color={color} size={18} />,
      onSelect: () => void download(fileName(plainText(journal.summary), 'ics', 'entry'), journal.ics, 'text/calendar').catch(() => {}),
    });
    if (onDelete) {
      menuItems.push({ label: 'Delete', icon: (color) => <TrashIcon color={color} />, danger: true, onSelect: () => setConfirmingDelete(true) });
    }
  }

  const kind = edits.start ? 'entry' : 'note';

  const main = (
    <View style={shared.main}>
      <View style={shared.editor}>
        {editing === 'summary' ? (
          <TextInput
            style={[shared.titleInput, shared.field, { borderColor: colors.textTertiary }]}
            value={edits.summary}
            onChangeText={(summary) => update({ summary })}
            onBlur={() => setEditing(null)}
            placeholder="Title"
            placeholderTextColor={colors.textTertiary}
            aria-label="Title"
            autoFocus
            submitBehavior="blurAndSubmit"
            returnKeyType="done"
          />
        ) : (
          <MarkdownView label="Title" formatted={hasMarkdown(edits.summary)} onEdit={() => setEditing('summary')}>
            {edits.summary ? (
              <Text style={shared.titleText}>
                <InlineMarkdown text={edits.summary} />
              </Text>
            ) : null}
          </MarkdownView>
        )}
        {editing === 'description' ? (
          <DescriptionInput
            value={edits.description}
            onChangeText={(description) => update({ description })}
            onBlur={() => setEditing(null)}
            placeholder="Write something…"
            label="Text"
            minHeight={TEXT_HEIGHT}
          />
        ) : (
          <MarkdownView
            label="Write something…"
            formatted={hasMarkdown(edits.description, true)}
            onEdit={() => setEditing('description')}
            description
            minHeight={TEXT_HEIGHT}
          >
            {edits.description.trim() ? <Markdown text={edits.description} style={shared.descriptionText} /> : null}
          </MarkdownView>
        )}
      </View>
    </View>
  );

  const sidebar = (
    <>
      <SidebarItem title="Journal">
        <CalendarField label="Journal" calendar={calendar} calendars={calendars} canPick={isNew && calendars.length > 1} onChange={setCalendar} />
      </SidebarItem>

      <SidebarItem title="Date" action={<SwitchRow label="All day" value={allDay} onChange={toggleAllDay} />}>
        <DateField label="Date" value={edits.start} allDay={allDay} onChange={(start) => update({ start })} />
        {!edits.start && <Text style={shared.note}>Without a date, this is a note.</Text>}
        {journal?.recurrence && (
          <View style={shared.inline}>
            <RepeatIcon color={edits.start ? colors.textTertiary : colors.dueTomorrow} />
            <Text style={[shared.note, !edits.start && { color: colors.dueTomorrow }]}>
              {edits.start ? describeRepeat(journal.recurrence, edits.start) : 'Without a date, the repeat is removed too.'}
            </Text>
          </View>
        )}
      </SidebarItem>

      <SidebarItem title="Status">
        <Select aria-label="Status" value={edits.status} onChange={(status) => update({ status })} options={STATUS_OPTIONS} />
      </SidebarItem>

      <SidebarItem title="Labels">
        <LabelsInput initial={edits.categories} onChange={(categories) => update({ categories })} />
      </SidebarItem>

      <SidebarItem title="Location">
        <LocationInput value={edits.location} onChange={(location) => update({ location })} />
      </SidebarItem>

      {journal && <Details url={journal.url} created={journal.created} lastModified={journal.lastModified} />}
      {journal && <UidLine uid={journal.uid} />}
    </>
  );

  return (
    <ModalShell
      guard={guard}
      label={isNew ? `Add ${kind}` : `Journal ${kind}`}
      calendar={calendar}
      menuItems={menuItems}
      onRequestClose={leave.requestClose}
      main={main}
      sidebar={sidebar}
      message={dirty ? problem : null}
      saveLabel={isNew ? `Add ${kind}` : 'Save'}
      canSave={canSave}
      onSave={save}
      keys={!leave.asking && !confirmingDelete}
    >
      {leave.asking && (
        <LeaveDialog kind={kind} isNew={isNew} problem={problem} onSave={() => onSave(edits, calendar.href)} onAnswer={leave.answer} />
      )}

      {confirmingDelete && journal && onDelete && (
        <ConfirmDialog
          title={`Delete ${journal.start ? 'entry' : 'note'}?`}
          message={`“${plainText(journal.summary) || 'Untitled'}” will be deleted.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            // Unsaved edits go with it: there is nothing left to save them to.
            setConfirmingDelete(false);
            leave.leaveNow();
            onDelete(journal);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </ModalShell>
  );
}
