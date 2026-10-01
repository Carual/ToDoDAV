import { useEffect, useState } from 'react';
import type { Calendar } from '../api/caldav.ts';
import type { LocalDate } from '../api/ical.ts';
import type { Journal, JournalEdits } from '../api/journals.ts';
import { describeDay, describeRepeat, formatTime } from '../format.ts';
import { InlineMarkdown, previewLine } from '../markdown.tsx';
import { todayDate } from '../repeat.ts';
import { journalPath, navigate } from '../router.ts';
import { useJournalList } from '../useJournalList.ts';
import { readSetting, saveSetting } from '../viewSettings.ts';
import { ChevronDownIcon, HashIcon, LayersIcon, MapPinIcon, PlusIcon, RepeatIcon, ShareIcon, TagIcon } from './icons.tsx';
import { JournalModal } from './JournalModal.tsx';
import type { Session } from './Login.tsx';
import { Select } from './Select.tsx';
import { ShareModal } from './ShareModal.tsx';
import { Spinner } from './Spinner.tsx';
import { useToast } from './Toast.tsx';
import { TopBar } from './TopBar.tsx';

const SELECTED_KEY = 'tododav.journalCalendar';
/** The "All" view's value where a journal href would go; hrefs start with / or a scheme, so it can't clash. */
const ALL = 'all';
const SHOW_NOTES_KEY = 'tododav.showNotes';

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

interface Props {
  session: Session;
  /** UID of the entry whose modal is open, from the URL (/journal/<uid>). */
  openUid?: string;
  onLogout: () => void;
  /** A journal was created on the server. */
  onJournalsChange: (journals: Calendar[]) => void;
}

export function JournalPage({ session, openUid, onLogout, onJournalsChange }: Props) {
  const { client, journals: calendars, config } = session;
  const canShare = config.feed !== undefined;
  const canShowAll = calendars.length > 1;
  const [selected, setSelected] = useState(() => {
    const saved = readSetting(SELECTED_KEY);
    if (saved === ALL && canShowAll) return ALL;
    return calendars.find((c) => c.href === saved)?.href ?? (canShowAll ? ALL : calendars[0]?.href);
  });
  const [showNotes, setShowNotes] = useState(() => readSetting(SHOW_NOTES_KEY) !== 'false');
  const allView = selected === ALL;
  /** The single journal on screen; undefined in the "All" view. */
  const calendar = calendars.find((c) => c.href === selected);
  const shownHrefs = allView ? calendars.map((c) => c.href) : calendar ? [calendar.href] : [];
  const hasJournals = calendars.length > 0;

  /** The modal for a new entry, with its date (none: a note). */
  const [creating, setCreating] = useState<{ start?: LocalDate } | null>(null);
  const [creatingJournal, setCreatingJournal] = useState(false);
  const [sharing, setSharing] = useState(false);
  const toast = useToast();
  const showToast = toast.show;

  const list = useJournalList({
    client,
    calendarHrefs: shownHrefs,
    onLogout,
    onWriteError: ({ message, retry }) => showToast({ message, action: retry && { label: 'Retry', run: retry } }),
  });
  const { journals } = list;
  const calendarOf = (journal: Journal): Calendar | undefined => calendars.find((c) => c.href === list.listOf(journal));

  function selectCalendar(href: string) {
    setSelected(href);
    saveSetting(SELECTED_KEY, href);
  }

  function toggleShowNotes() {
    setShowNotes(!showNotes);
    saveSetting(SHOW_NOTES_KEY, String(!showNotes));
  }

  const openEntry = (journal: Journal) => navigate(journalPath(journal.uid));
  const closeEntry = () => navigate('/journal');

  function createEntry(edits: JournalEdits, calendarHref: string) {
    list.create(calendarHref, edits);
    // Not a route, so Back/Forward alone wouldn't close it; left open, it could add the entry twice.
    setCreating(null);
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

  async function createJournal() {
    setCreatingJournal(true);
    try {
      const created = await client.createCalendar('Journal', undefined, 'VJOURNAL');
      onJournalsChange([...calendars, created]);
      selectCalendar(created.href);
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : 'Could not create the journal.' });
    } finally {
      setCreatingJournal(false);
    }
  }

  const days = byDay(journals.filter((j) => j.start));
  const notes = journals.filter((j) => !j.start).sort(compareNotes);
  const openJournal = openUid === undefined ? undefined : journals.find((j) => j.uid === openUid);
  const openJournalCalendar = openJournal && calendarOf(openJournal);
  /** Where a new entry goes unless the modal picks another journal. */
  const newEntryCalendar = calendar ?? calendars[0];
  const modalOpen = creating !== null || sharing || openJournal !== undefined;

  // An entry link can point to another journal (the URL has only the UID): look there and switch to it.
  const entryMissing = openUid !== undefined && !openJournal && list.fetched;
  const { locate } = list;
  const shownKey = shownHrefs.join('\n');
  useEffect(() => {
    if (!entryMissing || openUid === undefined) return;
    let cancelled = false;
    const shown = shownKey.split('\n');
    void locate(openUid, calendars.filter((c) => !shown.includes(c.href))).then((found) => {
      if (cancelled) return;
      if (found) return selectCalendar(found);
      showToast({ message: 'Entry not found' });
      navigate('/journal', { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [entryMissing, openUid, shownKey, calendars, locate]);

  // "Q" opens a new entry, as it opens a new task on the tasks page (not while typing or with a modal open).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key.toLowerCase() !== 'q' || event.ctrlKey || event.metaKey || event.altKey || typing) return;
      if (modalOpen || !hasJournals) return;
      event.preventDefault();
      setCreating({ start: todayDate() });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen, hasJournals]);

  const newEntry = () => setCreating({ start: todayDate() });

  return (
    <div className="app">
      <TopBar section="journal" username={client.username} onLogout={onLogout} />

      <main className="content">
        {!hasJournals ? (
          <div className="empty">
            <h2>No journals found</h2>
            <p>None of your calendars takes journal entries (VJOURNAL). Create one to start writing.</p>
            <button type="button" className="btn btn-primary" onClick={createJournal} disabled={creatingJournal}>
              {creatingJournal ? <Spinner label="Creating the journal" className="spinner-light" /> : 'Create journal'}
            </button>
          </div>
        ) : (
          <>
            <div className="view-header">
              <div className="view-title">
                <h1>{calendar?.name ?? 'Journal'}</h1>
              </div>
              <div className="view-actions">
                {/* Feeds are per calendar, so not in the "All" view. */}
                {canShare && calendar && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Add to Google Calendar"
                    title="Add to Google Calendar"
                    onClick={() => setSharing(true)}
                  >
                    <ShareIcon />
                  </button>
                )}
                {canShowAll && (
                  <Select
                    className="calendar-select"
                    aria-label="Journal"
                    value={selected ?? ALL}
                    onChange={selectCalendar}
                    options={[
                      { value: ALL, label: 'All', icon: <LayersIcon className="select-icon" /> },
                      ...calendars.map((c) => ({
                        value: c.href,
                        label: c.name,
                        icon: <HashIcon className="select-icon" style={{ color: c.color }} />,
                      })),
                    ]}
                  />
                )}
                <button
                  type="button"
                  className="icon-btn header-add"
                  aria-label="New entry"
                  title="New entry (Q)"
                  onClick={newEntry}
                >
                  <PlusIcon />
                </button>
              </div>
            </div>

            {list.loadError ? (
              <div className="empty">
                <p className="form-error">{list.loadError}</p>
                <button type="button" className="btn btn-secondary" onClick={list.reload}>
                  Try again
                </button>
              </div>
            ) : !list.loaded ? (
              <div className="loading">
                <Spinner label="Loading the journal" />
              </div>
            ) : (
              <>
                <button type="button" className="add-task" onClick={newEntry}>
                  <span className="add-task-icon" aria-hidden="true">
                    <PlusIcon />
                  </span>
                  New entry
                </button>
                {days.length === 0 && (
                  <div className="empty">
                    <h2>No entries yet</h2>
                    <p>Entries {allView ? 'in your journals' : 'in this journal'} show here, by day.</p>
                  </div>
                )}
                {days.map(({ date, entries }) => (
                  <section key={date} className="journal-day" aria-label={describeDay(date)}>
                    <h2 className="journal-day-heading">
                      {describeDay(date)}
                      <span className="journal-day-count">{entries.length}</span>
                    </h2>
                    <ul className="task-list">
                      {entries.map((entry) => (
                        <JournalItem
                          key={entry.href}
                          journal={entry}
                          project={allView ? calendarOf(entry) : undefined}
                          onOpen={openEntry}
                        />
                      ))}
                    </ul>
                  </section>
                ))}

                <section className="completed-section">
                  <button type="button" className="completed-toggle" aria-expanded={showNotes} onClick={toggleShowNotes}>
                    <ChevronDownIcon />
                    Notes
                    <span className="completed-count">{notes.length}</span>
                  </button>
                  {showNotes && (
                    <>
                      {notes.length > 0 && (
                        <ul className="task-list">
                          {notes.map((note) => (
                            <JournalItem
                              key={note.href}
                              journal={note}
                              project={allView ? calendarOf(note) : undefined}
                              onOpen={openEntry}
                            />
                          ))}
                        </ul>
                      )}
                      <button type="button" className="add-task" onClick={() => setCreating({})}>
                        <span className="add-task-icon" aria-hidden="true">
                          <PlusIcon />
                        </span>
                        Add note
                      </button>
                    </>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </main>

      {newEntryCalendar && creating && (
        <JournalModal
          key="new"
          calendar={newEntryCalendar}
          calendars={calendars}
          initialStart={creating.start}
          onClose={() => setCreating(null)}
          onSave={createEntry}
        />
      )}

      {openJournalCalendar && !creating && openJournal && (
        <JournalModal
          // Remount only when the content changes (a reload or a failed save), not when a save just confirms it.
          key={`${openJournal.href} ${openJournal.ics}`}
          journal={openJournal}
          calendar={openJournalCalendar}
          onClose={closeEntry}
          onSave={(edits) => list.edit(openJournal.href, edits)}
          onDelete={deleteEntry}
        />
      )}

      {calendar && sharing && config.feed && (
        <ShareModal
          client={client}
          calendar={calendar}
          token={config.feed.token}
          section="journal"
          onClose={() => setSharing(false)}
        />
      )}

      {toast.element}
    </div>
  );
}

interface ItemProps {
  journal: Journal;
  /** The journal it is in, shown only where entries of several journals mix (the "All" view). */
  project?: Calendar;
  onOpen: (journal: Journal) => void;
}

/** One entry or note: its time, title, first line of text, then labels and location. */
function JournalItem({ journal, project, onOpen }: ItemProps) {
  const { start, recurrence } = journal;
  const firstLine = previewLine(journal.description);
  // Entries without a title (common in jtx Board) are known by their first line.
  const title = journal.summary || firstLine;
  const repeat = recurrence && describeRepeat(recurrence, start);
  const classes = ['task', 'journal-entry', journal.status === 'CANCELLED' ? 'journal-cancelled' : ''].filter(Boolean);
  return (
    <li className={classes.join(' ')} onClick={() => onOpen(journal)}>
      {start && <span className="journal-time">{start.time ? formatTime(start.time) : 'All day'}</span>}
      <div className="task-body">
        <div className="task-title">
          {title ? <InlineMarkdown text={title} /> : <span className="muted">Untitled</span>}
          {journal.status === 'DRAFT' && <span className="journal-badge">Draft</span>}
        </div>
        {journal.summary && firstLine && (
          <div className="task-desc">
            <InlineMarkdown text={firstLine} />
          </div>
        )}
        {(repeat || journal.categories.length > 0) && (
          <div className="task-meta">
            {repeat && (
              <span className="label" title={repeat}>
                <RepeatIcon />
                {repeat}
              </span>
            )}
            {journal.categories.map((label) => (
              <span key={label} className="label">
                <TagIcon />
                {label}
              </span>
            ))}
          </div>
        )}
        {journal.location && (
          <div className="task-location">
            <MapPinIcon />
            <span>{journal.location}</span>
          </div>
        )}
      </div>
      {project && (
        <span className="task-project" title={`In ${project.name}`}>
          <span className="task-project-name">{project.name}</span>
          <HashIcon style={{ color: project.color }} />
        </span>
      )}
    </li>
  );
}
