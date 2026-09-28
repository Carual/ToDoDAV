import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Calendar } from '../api/caldav.ts';
import { sameDate, type LocalDate, type Priority, type Task, type TaskEdits } from '../api/tasks.ts';
import { describeDue, formatDateTime } from '../format.ts';
import { useLeaveGuard } from '../router.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { CloseIcon, FlagIcon, HashIcon, MapPinIcon, PlusIcon } from './icons.tsx';
import { TaskCheckbox } from './TaskItem.tsx';

interface Props {
  /** The task to show and edit; absent when adding a new one. */
  task?: Task;
  /** The task this one is a sub-task of. */
  parent?: Task;
  /** Direct sub-tasks, in the order to show them. */
  subtasks?: Task[];
  calendar: Calendar;
  onClose: () => void;
  /** Takes the edits and closes the modal at once; the save runs in the background. */
  onSave: (edits: TaskEdits) => void;
  /** Completes an open task or reopens a completed one. */
  onToggle: (task: Task) => void;
  /** Shows another task (a parent or a sub-task) in place of this one. */
  onOpenTask?: (task: Task) => void;
  /** Adds an open sub-task with this name; the save runs in the background. */
  onAddSubtask?: (summary: string) => void;
  /** Show a map under the location (a setting, off by default). */
  showMap?: boolean;
}

const PRIORITIES: Priority[] = [1, 2, 3, 4];
/** Time given to a date when "All day" is switched off. */
const DEFAULT_TIME = '09:00';

function initialEdits(task: Task | undefined): TaskEdits {
  if (!task) return { summary: '', description: '', priority: 4, categories: [], location: '' };
  return {
    summary: task.summary,
    description: task.description,
    start: task.start,
    due: task.due,
    priority: task.priority,
    categories: task.categories,
    location: task.location ?? '',
  };
}

function sameEdits(a: TaskEdits, b: TaskEdits): boolean {
  return (
    a.summary === b.summary &&
    a.description === b.description &&
    sameDate(a.start, b.start) &&
    sameDate(a.due, b.due) &&
    a.priority === b.priority &&
    a.categories.join('\n') === b.categories.join('\n') &&
    a.location === b.location
  );
}

/** Google Maps URLs need no API key; the map only loads when the user opens the link. */
const mapUrl = (location: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
// Undocumented but keyless; the official Embed API would need every install to bring its own key.
// If Google ever drops it, the frame breaks but the link above keeps working.
const embedUrl = (location: string) => `https://www.google.com/maps?q=${encodeURIComponent(location)}&output=embed`;
/** Waits for typing to pause before reloading the map. */
const MAP_DELAY_MS = 700;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** All-day dates carry no time; timed dates always carry one. */
function inMode(date: LocalDate | undefined, allDay: boolean): LocalDate | undefined {
  if (!date) return undefined;
  return allDay ? { date: date.date } : { date: date.date, time: date.time ?? DEFAULT_TIME };
}

const sortKey = (date: LocalDate) => `${date.date}T${date.time ?? '00:00'}`;

function problemWith(edits: TaskEdits): string | null {
  if (!edits.summary.trim()) return 'The task needs a name.';
  if (edits.start && edits.due && sortKey(edits.start) > sortKey(edits.due)) {
    return 'The start date must be before the due date.';
  }
  return null;
}

export function TaskModal({
  task,
  parent,
  subtasks = [],
  calendar,
  onClose,
  onSave,
  onToggle,
  onOpenTask,
  onAddSubtask,
  showMap = false,
}: Props) {
  const isNew = task === undefined;
  const [edits, setEdits] = useState(() => initialEdits(task));
  const [allDay, setAllDay] = useState(() => !task?.start?.time && !task?.due?.time);
  const [labelsText, setLabelsText] = useState(() => task?.categories.join(', ') ?? '');
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const mapLocation = useDebounced(edits.location.trim(), MAP_DELAY_MS);

  const update = (patch: Partial<TaskEdits>) => setEdits((current) => ({ ...current, ...patch }));
  const dirty = !sameEdits(edits, initialEdits(task));
  // What gets saved: both dates brought to the chosen mode (RFC 5545 wants DTSTART and DUE of the same type).
  const finalEdits: TaskEdits = { ...edits, start: inMode(edits.start, allDay), due: inMode(edits.due, allDay) };
  const problem = problemWith(finalEdits);
  const canSave = dirty && !problem;

  // A sub-task name typed but not added yet is unsaved work too, though Save does not add it.
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const guarded = dirty || subtaskDraft.trim() !== '';

  function toggleAllDay(next: boolean) {
    setAllDay(next);
    update({ start: inMode(edits.start, next), due: inMode(edits.due, next) });
  }

  // One question at a time: every way out (close controls, Back/Forward) waits on the same answer.
  const [askingDiscard, setAskingDiscard] = useState(false);
  const discardAnswer = useRef<{ promise: Promise<boolean>; resolve: (discard: boolean) => void } | null>(null);

  const askDiscard = useCallback((): Promise<boolean> => {
    if (!discardAnswer.current) {
      let resolve!: (discard: boolean) => void;
      const promise = new Promise<boolean>((r) => (resolve = r));
      discardAnswer.current = { promise, resolve };
      setAskingDiscard(true);
    }
    return discardAnswer.current.promise;
  }, []);

  function answerDiscard(discard: boolean) {
    discardAnswer.current?.resolve(discard);
    discardAnswer.current = null;
    setAskingDiscard(false);
  }

  // Closing for another reason while asking must still settle the question (the router waits on it).
  useEffect(() => () => discardAnswer.current?.resolve(false), []);

  // Back/Forward ask too, not only the modal's own close controls.
  useLeaveGuard(guarded, askDiscard);

  /** Leaves the modal (to close it or to show another task), asking first if something is unsaved. */
  function leave(then: () => void) {
    if (!guarded) return then();
    void askDiscard().then((discard) => discard && then());
  }

  const requestClose = () => leave(onClose);
  const openOther = onOpenTask && ((other: Task) => leave(() => onOpenTask(other)));

  function addSubtask() {
    const summary = subtaskDraft.trim();
    if (!summary || !onAddSubtask) return;
    onAddSubtask(summary);
    setSubtaskDraft(''); // stays open for the next one, like Todoist
  }

  function stopAddingSubtask() {
    setAddingSubtask(false);
    setSubtaskDraft('');
  }

  function save() {
    if (canSave) onSave(finalEdits);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (askingDiscard) return; // the dialog on top owns the keyboard
      if (event.key === 'Escape') requestClose();
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Grow the description box with its content, like Todoist.
  useEffect(() => {
    const textarea = descriptionRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [edits.description]);

  const message = dirty ? problem : null;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={isNew ? 'Add task' : 'Task details'}>
        <header className="modal-header">
          <span className="modal-crumb">
            <HashIcon style={{ color: calendar.color }} />
            {calendar.name}
            {parent && openOther && (
              <>
                <span className="modal-crumb-sep" aria-hidden="true">
                  /
                </span>
                <button
                  type="button"
                  className="modal-crumb-link"
                  title="Open the parent task"
                  onClick={() => openOther(parent)}
                >
                  {parent.summary || 'Untitled task'}
                </button>
              </>
            )}
          </span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={requestClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="modal-content">
          <section className="modal-main">
            <div className="modal-title-row">
              {task ? (
                <TaskCheckbox
                  task={{ ...task, priority: edits.priority }}
                  onToggle={(toggled) => {
                    onToggle(toggled);
                    onClose();
                  }}
                />
              ) : (
                // Nothing to complete yet: just the circle, in the chosen priority color.
                <span className={`task-check task-check-static p${edits.priority}`} aria-hidden="true" />
              )}
              <div className="modal-editor">
                <input
                  className="modal-title"
                  value={edits.summary}
                  onChange={(e) => update({ summary: e.target.value })}
                  placeholder="Task name"
                  aria-label="Task name"
                  autoFocus
                />
                <textarea
                  ref={descriptionRef}
                  className="modal-description"
                  value={edits.description}
                  onChange={(e) => update({ description: e.target.value })}
                  placeholder="Description"
                  aria-label="Description"
                  rows={1}
                />
              </div>
            </div>

            {task && onAddSubtask && (
              <section className="subtasks" aria-label="Sub-tasks">
                {subtasks.length > 0 && (
                  <>
                    <h3 className="subtasks-title">
                      Sub-tasks
                      <span className="subtasks-count">
                        {subtasks.filter((s) => s.completed).length}/{subtasks.length}
                      </span>
                    </h3>
                    <ul className="subtask-list">
                      {subtasks.map((subtask) => (
                        // Keyed on the state too, so the checkbox starts over if a failed save flips it back.
                        <SubtaskRow
                          key={`${subtask.href} ${subtask.completed}`}
                          task={subtask}
                          onOpen={openOther}
                          onToggle={onToggle}
                        />
                      ))}
                    </ul>
                  </>
                )}
                {addingSubtask ? (
                  <form
                    className="subtask-add"
                    onSubmit={(event) => {
                      event.preventDefault();
                      addSubtask();
                    }}
                  >
                    <input
                      value={subtaskDraft}
                      onChange={(e) => setSubtaskDraft(e.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Escape') return;
                        event.stopPropagation(); // closes this field, not the whole modal
                        stopAddingSubtask();
                      }}
                      placeholder="Sub-task name"
                      aria-label="Sub-task name"
                      autoFocus
                    />
                    <button type="button" className="btn btn-secondary" onClick={stopAddingSubtask}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={!subtaskDraft.trim()}>
                      Add
                    </button>
                  </form>
                ) : (
                  <button type="button" className="add-task" onClick={() => setAddingSubtask(true)}>
                    <span className="add-task-icon" aria-hidden="true">
                      <PlusIcon />
                    </span>
                    Add sub-task
                  </button>
                )}
              </section>
            )}
          </section>

          <aside className="modal-sidebar">
            <SidebarItem title="Project">
              <span className="sidebar-value">
                <HashIcon style={{ color: calendar.color }} />
                {calendar.name}
              </span>
            </SidebarItem>

            <SidebarItem
              title="Dates"
              action={
                <label className="switch">
                  <input type="checkbox" checked={allDay} onChange={(e) => toggleAllDay(e.target.checked)} />
                  <span className="switch-track" aria-hidden="true" />
                  All day
                </label>
              }
            >
              <DateField label="Start date" value={edits.start} allDay={allDay} onChange={(start) => update({ start })} />
              <DateField label="Due date" value={edits.due} allDay={allDay} colored onChange={(due) => update({ due })} />
            </SidebarItem>

            <SidebarItem title="Priority">
              <label className={`priority-select p${edits.priority}`}>
                <FlagIcon />
                <select
                  value={edits.priority}
                  onChange={(e) => update({ priority: Number(e.target.value) as Priority })}
                  aria-label="Priority"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      Priority {p}
                    </option>
                  ))}
                </select>
              </label>
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
              {showMap && mapLocation && (
                <iframe className="location-map" src={embedUrl(mapLocation)} title={`Map of ${mapLocation}`} loading="lazy" />
              )}
            </SidebarItem>

            {task && hasDetails(task) && (
              <SidebarItem title="Details">
                <dl className="details">
                  {task.status && <Detail term="Status">{task.status.toLowerCase().replace('-', ' ')}</Detail>}
                  {task.percentComplete !== undefined && <Detail term="Progress">{task.percentComplete}%</Detail>}
                  {task.url && (
                    <Detail term="Link">
                      {/* Only http(s) becomes a link: a task could carry a javascript: URL. */}
                      {/^https?:\/\//i.test(task.url) ? (
                        <a href={task.url} target="_blank" rel="noreferrer noopener">
                          {task.url}
                        </a>
                      ) : (
                        task.url
                      )}
                    </Detail>
                  )}
                  {task.created && <Detail term="Created">{formatDateTime(task.created)}</Detail>}
                  {task.lastModified && <Detail term="Modified">{formatDateTime(task.lastModified)}</Detail>}
                </dl>
              </SidebarItem>
            )}

            {task && (
              <p className="modal-uid" title="UID: this task's identifier, also in its link">
                UID <span className="modal-uid-value">{task.uid}</span>
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
            title={`${isNew ? 'Add task' : 'Save'} (Ctrl+Enter)`}
          >
            {isNew ? 'Add task' : 'Save'}
          </button>
        </footer>
      </div>

      {askingDiscard && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message={isNew ? 'This task has not been added yet.' : 'The changes you made to this task will be lost.'}
          confirmLabel="Discard"
          onConfirm={() => answerDiscard(true)}
          onCancel={() => answerDiscard(false)}
        />
      )}
    </div>
  );
}

interface DateFieldProps {
  label: string;
  value: LocalDate | undefined;
  allDay: boolean;
  /** Color the summary by urgency (overdue, today...), as for due dates. */
  colored?: boolean;
  onChange: (value: LocalDate | undefined) => void;
}

function DateField({ label, value, allDay, colored = false, onChange }: DateFieldProps) {
  const summary = value && describeDue(value);
  return (
    <div className="date-field">
      <span className="date-field-label">{label}</span>
      <div className="date-field-row">
        {allDay ? (
          <input
            type="date"
            value={value?.date ?? ''}
            onChange={(e) => onChange(e.target.value ? { date: e.target.value } : undefined)}
            aria-label={label}
          />
        ) : (
          <input
            type="datetime-local"
            value={value ? `${value.date}T${value.time ?? DEFAULT_TIME}` : ''}
            onChange={(e) => {
              const [date, time] = e.target.value.split('T');
              onChange(date ? { date, time: time?.slice(0, 5) || DEFAULT_TIME } : undefined);
            }}
            aria-label={label}
          />
        )}
        {value && (
          <button
            type="button"
            className="icon-btn icon-btn-small"
            aria-label={`Remove ${label.toLowerCase()}`}
            title="Remove"
            onClick={() => onChange(undefined)}
          >
            <CloseIcon />
          </button>
        )}
      </div>
      {summary && <span className={`due due-${colored ? summary.tone : 'later'} sidebar-note`}>{summary.label}</span>}
    </div>
  );
}

function SubtaskRow({ task, onOpen, onToggle }: { task: Task; onOpen?: (task: Task) => void; onToggle: (task: Task) => void }) {
  const due = task.due && describeDue(task.due);
  return (
    <li className={`subtask${task.completed ? ' task-done' : ''}`} onClick={() => onOpen?.(task)}>
      <TaskCheckbox task={task} onToggle={onToggle} />
      <span className="task-title">{task.summary || <span className="muted">Untitled task</span>}</span>
      {due && <span className={`due due-${due.tone}`}>{due.label}</span>}
    </li>
  );
}

function hasDetails(task: Task): boolean {
  return Boolean(task.status || task.percentComplete !== undefined || task.url || task.created || task.lastModified);
}

function SidebarItem({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="sidebar-item">
      <div className="sidebar-item-header">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}
