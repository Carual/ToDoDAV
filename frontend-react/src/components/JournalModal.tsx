import { useEffect, useRef, useState } from 'react';
import type { Calendar } from '../api/caldav.ts';
import { sameDate, type LocalDate } from '../api/ical.ts';
import type { Journal, JournalEdits, JournalStatus } from '../api/journals.ts';
import { download, fileName } from '../download.ts';
import { describeRepeat, formatDateTime } from '../format.ts';
import { hasMarkdown, InlineMarkdown, Markdown, plainText } from '../markdown.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { CloseIcon, DownloadIcon, HashIcon, MapPinIcon, RepeatIcon, TrashIcon } from './icons.tsx';
import { Menu, type MenuItem } from './Menu.tsx';
import { DateField, DEFAULT_TIME, Detail, MarkdownView, SidebarItem, UrlDetail, useLeavePrompt } from './modalParts.tsx';
import { Select } from './Select.tsx';

interface Props {
  /** The entry to show and edit; absent when adding a new one. */
  journal?: Journal;
  /** The entry's journal; for a new entry, the one chosen at first. */
  calendar: Calendar;
  /** The journals a new entry can go in; with more than one, the modal lets the user pick. */
  calendars?: Calendar[];
  /** A new entry's date; none makes it a note. */
  initialStart?: LocalDate;
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

/** Google Maps URLs need no API key; the map only loads when the user opens the link. */
const mapUrl = (location: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;

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

export function JournalModal({ journal, calendar: initialCalendar, calendars = [], initialStart, onClose, onSave, onDelete }: Props) {
  const isNew = journal === undefined;
  const [calendar, setCalendar] = useState(initialCalendar);
  const canPickCalendar = isNew && calendars.length > 1;
  const [edits, setEdits] = useState(() => initialEdits(journal, initialStart));
  const [allDay, setAllDay] = useState(() => !(journal ? journal.start : initialStart)?.time);
  const [labelsText, setLabelsText] = useState(() => journal?.categories.join(', ') ?? '');
  // As in the task modal: formatted text that turns into its editor when clicked. A new entry starts with the title.
  const [editing, setEditing] = useState<'summary' | 'description' | null>(isNew ? 'summary' : null);
  const stopEditing = () => document.hasFocus() && setEditing(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const update = (patch: Partial<JournalEdits>) => setEdits((current) => ({ ...current, ...patch }));
  const dirty = !sameEdits(edits, initialEdits(journal, initialStart));
  const problem = !edits.summary.trim() && !edits.description.trim() ? 'The entry needs a title or some text.' : null;
  const canSave = dirty && !problem;
  const { asking, answer, leave } = useLeavePrompt(dirty);

  function toggleAllDay(next: boolean) {
    setAllDay(next);
    if (edits.start) update({ start: next ? { date: edits.start.date } : { ...edits.start, time: edits.start.time ?? DEFAULT_TIME } });
  }

  const requestClose = () => leave(onClose);

  function save() {
    if (!canSave) return;
    onSave(edits, calendar.href);
    onClose();
  }

  function saveAndLeave() {
    onSave(edits, calendar.href);
    answer(true);
  }

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const menuItems: MenuItem[] = [];
  if (journal) {
    // The file as stored on the server (repeats and overrides included), not the unsaved edits.
    menuItems.push({
      label: 'Download as .ics',
      icon: <DownloadIcon />,
      title: 'Download the saved version as an iCalendar file',
      onSelect: () => download(fileName(plainText(journal.summary), 'ics', 'entry'), journal.ics, 'text/calendar'),
    });
    if (onDelete) menuItems.push({ label: 'Delete', icon: <TrashIcon />, danger: true, onSelect: () => setConfirmingDelete(true) });
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (asking || confirmingDelete) return; // the dialog on top owns the keyboard
      if (event.key === 'Escape') requestClose();
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const field = editing === 'summary' ? titleRef.current : editing === 'description' ? descriptionRef.current : null;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [editing]);

  useEffect(() => {
    const textarea = descriptionRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [edits.description, editing]);

  const kind = edits.start ? 'entry' : 'note';
  const message = dirty ? problem : null;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <div className="modal journal-modal" role="dialog" aria-modal="true" aria-label={isNew ? `Add ${kind}` : `Journal ${kind}`}>
        <header className="modal-header">
          <span className="modal-crumb">
            <HashIcon style={{ color: calendar.color }} />
            {calendar.name}
          </span>
          <div className="modal-header-actions">
            {menuItems.length > 0 && <Menu aria-label="More actions" items={menuItems} />}
            <button type="button" className="icon-btn" aria-label="Close" onClick={requestClose}>
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="modal-content">
          <section className="modal-main">
            <div className="modal-editor">
              {editing === 'summary' ? (
                <input
                  ref={titleRef}
                  className="modal-title"
                  value={edits.summary}
                  onChange={(e) => update({ summary: e.target.value })}
                  onBlur={stopEditing}
                  placeholder="Title"
                  aria-label="Title"
                />
              ) : (
                <MarkdownView
                  className="modal-title"
                  label="Title"
                  formatted={hasMarkdown(edits.summary)}
                  onEdit={() => setEditing('summary')}
                >
                  {edits.summary && <InlineMarkdown text={edits.summary} />}
                </MarkdownView>
              )}
              {editing === 'description' ? (
                <textarea
                  ref={descriptionRef}
                  className="modal-description"
                  value={edits.description}
                  onChange={(e) => update({ description: e.target.value })}
                  onBlur={stopEditing}
                  placeholder="Write something…"
                  aria-label="Text"
                  rows={6}
                />
              ) : (
                <MarkdownView
                  className="modal-description markdown"
                  label="Write something…"
                  formatted={hasMarkdown(edits.description, true)}
                  onEdit={() => setEditing('description')}
                >
                  {edits.description.trim() && <Markdown text={edits.description} />}
                </MarkdownView>
              )}
            </div>
          </section>

          <aside className="modal-sidebar">
            <SidebarItem title="Journal">
              {canPickCalendar ? (
                <Select
                  aria-label="Journal"
                  value={calendar.href}
                  onChange={(href) => setCalendar(calendars.find((c) => c.href === href) ?? calendar)}
                  options={calendars.map((c) => ({
                    value: c.href,
                    label: c.name,
                    icon: <HashIcon className="select-icon" style={{ color: c.color }} />,
                  }))}
                />
              ) : (
                <span className="sidebar-value">
                  <HashIcon style={{ color: calendar.color }} />
                  {calendar.name}
                </span>
              )}
            </SidebarItem>

            <SidebarItem
              title="Date"
              action={
                <div className="sidebar-switches">
                  <label className="switch">
                    <input type="checkbox" checked={allDay} onChange={(e) => toggleAllDay(e.target.checked)} />
                    <span className="switch-track" aria-hidden="true" />
                    All day
                  </label>
                </div>
              }
            >
              <DateField label="Date" value={edits.start} allDay={allDay} onChange={(start) => update({ start })} />
              {!edits.start && <p className="repeat-note">Without a date, this is a note.</p>}
              {journal?.recurrence &&
                (edits.start ? (
                  <p className="repeat-note">
                    <RepeatIcon />
                    {describeRepeat(journal.recurrence, edits.start)}
                  </p>
                ) : (
                  <p className="repeat-note repeat-note-warning">
                    <RepeatIcon />
                    Without a date, the repeat is removed too.
                  </p>
                ))}
            </SidebarItem>

            <SidebarItem title="Status">
              <Select aria-label="Status" value={edits.status} onChange={(status) => update({ status })} options={STATUS_OPTIONS} />
            </SidebarItem>

            <SidebarItem title="Labels">
              <input
                className="sidebar-text"
                value={labelsText}
                onChange={(e) => {
                  setLabelsText(e.target.value);
                  update({ categories: e.target.value.split(',').map((l) => l.trim()).filter(Boolean) });
                }}
                placeholder="Comma separated"
                aria-label="Labels"
              />
            </SidebarItem>

            <SidebarItem title="Location">
              <div className="location-row">
                <input
                  className="sidebar-text"
                  value={edits.location}
                  onChange={(e) => update({ location: e.target.value })}
                  placeholder="Address or place"
                  aria-label="Location"
                />
                {edits.location.trim() && (
                  <a
                    className="location-open"
                    href={mapUrl(edits.location.trim())}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label="Open in Google Maps"
                    title="Open in Google Maps"
                  >
                    <MapPinIcon />
                  </a>
                )}
              </div>
            </SidebarItem>

            {journal && (journal.url || journal.created || journal.lastModified) && (
              <SidebarItem title="Details">
                <dl className="details">
                  {journal.url && <UrlDetail url={journal.url} />}
                  {journal.created && <Detail term="Created">{formatDateTime(journal.created)}</Detail>}
                  {journal.lastModified && <Detail term="Modified">{formatDateTime(journal.lastModified)}</Detail>}
                </dl>
              </SidebarItem>
            )}

            {journal && (
              <p className="modal-uid" title="UID: this entry's identifier, also in its link">
                UID <span className="modal-uid-value">{journal.uid}</span>
              </p>
            )}
          </aside>
        </div>

        <footer className="modal-footer">
          <span className="modal-footer-message" role="alert">
            {message}
          </span>
          <button type="button" className="btn btn-secondary" onClick={requestClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={save}
            disabled={!canSave}
            title={`${isNew ? `Add ${kind}` : 'Save'} (Ctrl+Enter)`}
          >
            {isNew ? `Add ${kind}` : 'Save'}
          </button>
        </footer>
      </div>

      {asking && (
        <ConfirmDialog
          title={isNew ? `Add this ${kind}?` : 'Save changes?'}
          message={
            problem
              ? `${problem} Fix it to save, or discard the changes.`
              : isNew
                ? `This ${kind} has not been added yet.`
                : `The changes you made to this ${kind} have not been saved.`
          }
          confirmLabel={isNew ? `Add ${kind}` : 'Save'}
          confirmDisabled={Boolean(problem)}
          onConfirm={saveAndLeave}
          onCancel={() => answer(false)}
          alternative={{ label: 'Discard', onClick: () => answer(true) }}
        />
      )}

      {confirmingDelete && journal && onDelete && (
        <ConfirmDialog
          title={`Delete ${journal.start ? 'entry' : 'note'}?`}
          message={`“${plainText(journal.summary) || 'Untitled'}” will be deleted.`}
          confirmLabel="Delete"
          onConfirm={() => {
            // Unsaved edits go with it: there is nothing left to save them to.
            onClose();
            onDelete(journal);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
