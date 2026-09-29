import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Calendar } from '../api/caldav.ts';
import { sameDate, type LocalDate, type Priority, type Task, type TaskEdits } from '../api/tasks.ts';
import { download, fileName } from '../download.ts';
import { describeDue, formatDateTime } from '../format.ts';
import { addDaysTo, daysBetween, firstOccurrence, moveRule, repeatProblem, todayDate, withUntilFor } from '../repeat.ts';
import { useLeaveGuard } from '../router.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { DatePicker } from './DatePicker.tsx';
import { CheckIcon, CloseIcon, DownloadIcon, FlagIcon, HashIcon, MapPinIcon, PlusIcon, RepeatIcon } from './icons.tsx';
import { RepeatField } from './RepeatField.tsx';
import { Select } from './Select.tsx';
import { RepeatMark, TaskCheckbox } from './TaskItem.tsx';
import { TimeField } from './TimeField.tsx';

interface Props {
  /** The task to show and edit; absent when adding a new one. */
  task?: Task;
  /** The task this one is a sub-task of. */
  parent?: Task;
  /** Direct sub-tasks, in the order to show them. */
  subtasks?: Task[];
  /** The task's list; for a new task, the one chosen at first. */
  calendar: Calendar;
  /** The lists a new task can go in; with more than one, the modal lets the user pick. */
  calendars?: Calendar[];
  onClose: () => void;
  /**
   * Takes the edits and the list the task is in (for a new task, the one picked); the save runs in the
   * background. The modal leaves on its own afterwards (closing, or showing another task), so this must not navigate.
   */
  onSave: (edits: TaskEdits, calendarHref: string) => void;
  /** Completes an open task or reopens a completed one; a repeating task moves to its next date instead. */
  onToggle: (task: Task) => void;
  /** Completes a repeating task for good instead of moving it to its next date. */
  onCompleteForGood?: (task: Task) => void;
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
    recurrence: task.recurrence,
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
    a.location === b.location &&
    a.recurrence === b.recurrence
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
  return edits.recurrence ? repeatProblem(edits.recurrence, edits.start ?? edits.due) : null;
}

export function TaskModal({
  task,
  parent,
  subtasks = [],
  calendar: initialCalendar,
  calendars = [],
  onClose,
  onSave,
  onToggle,
  onCompleteForGood,
  onOpenTask,
  onAddSubtask,
  showMap = false,
}: Props) {
  const isNew = task === undefined;
  const [calendar, setCalendar] = useState(initialCalendar);
  const canPickCalendar = isNew && calendars.length > 1;
  const [edits, setEdits] = useState(() => initialEdits(task));
  const [allDay, setAllDay] = useState(() => !task?.start?.time && !task?.due?.time);
  const [labelsText, setLabelsText] = useState(() => task?.categories.join(', ') ?? '');
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const mapLocation = useDebounced(edits.location.trim(), MAP_DELAY_MS);

  const update = (patch: Partial<TaskEdits>) => setEdits((current) => ({ ...current, ...patch }));
  const dirty = !sameEdits(edits, initialEdits(task));
  // What gets saved: both dates brought to the chosen mode (RFC 5545 wants DTSTART and DUE of the same type,
  // and the repeat's UNTIL of that type too).
  const finalEdits: TaskEdits = {
    ...edits,
    start: inMode(edits.start, allDay),
    due: inMode(edits.due, allDay),
    recurrence: edits.recurrence && withUntilFor(edits.recurrence, allDay),
  };
  const repeatAnchor = finalEdits.start ?? finalEdits.due ?? todayDate();
  const problem = problemWith(finalEdits);
  const canSave = dirty && !problem;

  // A sub-task name typed but not added yet is unsaved work too, though Save does not add it.
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const guarded = dirty || subtaskDraft.trim() !== '';

  /** Most tasks only have a due date: the start date's field shows only for tasks that have one, or on request. */
  const [showStart, setShowStart] = useState(() => task?.start !== undefined);

  function toggleStart(next: boolean) {
    setShowStart(next);
    if (!next && edits.start) changeDate('start', undefined);
  }

  function toggleAllDay(next: boolean) {
    setAllDay(next);
    update({ start: inMode(edits.start, next), due: inMode(edits.due, next) });
  }

  /** A new date also moves a repeat that follows it ("every week on Friday" becomes Monday's). */
  function changeDate(field: 'start' | 'due', value: LocalDate | undefined) {
    const from = edits.start ?? edits.due;
    const to = field === 'start' ? (value ?? edits.due) : (edits.start ?? value);
    const { recurrence } = edits;
    update({ [field]: value, recurrence: recurrence && from && to ? moveRule(recurrence, from, to, allDay) : recurrence });
  }

  function changeRepeat(recurrence: string | undefined) {
    if (!recurrence) return update({ recurrence });
    // As in Todoist, a repeat on a task without a date starts today...
    const due = edits.start || edits.due ? edits.due : inMode(todayDate(), allDay);
    // ...and on its first occurrence: "every Monday" chosen on a Friday moves the task to Monday.
    const anchor = edits.start ?? due!;
    const shift = daysBetween(anchor, firstOccurrence(recurrence, anchor));
    update({ recurrence, start: addDaysTo(edits.start, shift), due: addDaysTo(due, shift) });
  }

  // One question at a time: every way out (close controls, Back/Forward) waits on the same answer,
  // which only says whether to go on leaving. Saving, when chosen, is done by the dialog itself.
  const [askingLeave, setAskingLeave] = useState(false);
  const leaveAnswer = useRef<{ promise: Promise<boolean>; resolve: (leave: boolean) => void } | null>(null);

  const askLeave = useCallback((): Promise<boolean> => {
    if (!leaveAnswer.current) {
      let resolve!: (leave: boolean) => void;
      const promise = new Promise<boolean>((r) => (resolve = r));
      leaveAnswer.current = { promise, resolve };
      setAskingLeave(true);
    }
    return leaveAnswer.current.promise;
  }, []);

  function answerLeave(leave: boolean) {
    leaveAnswer.current?.resolve(leave);
    leaveAnswer.current = null;
    setAskingLeave(false);
  }

  // Closing for another reason while asking must still settle the question (the router waits on it).
  useEffect(() => () => leaveAnswer.current?.resolve(false), []);

  // Back/Forward ask too, not only the modal's own close controls.
  useLeaveGuard(guarded, askLeave);

  /** Leaves the modal (to close it or to show another task), asking first if something is unsaved. */
  function leave(then: () => void) {
    if (!guarded) return then();
    void askLeave().then((leave) => leave && then());
  }

  /** Everything unsaved, sub-task name included, is kept, and then the modal is left as asked. */
  function saveAndLeave() {
    if (dirty) onSave(finalEdits, calendar.href);
    if (subtaskDraft.trim()) addSubtask();
    answerLeave(true);
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
    if (!canSave) return;
    onSave(finalEdits, calendar.href);
    onClose();
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (askingLeave) return; // the dialog on top owns the keyboard
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
              {canPickCalendar ? (
                <Select
                  aria-label="Project"
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
              title="Dates"
              action={
                <div className="sidebar-switches">
                  <label className="switch">
                    <input type="checkbox" checked={allDay} onChange={(e) => toggleAllDay(e.target.checked)} />
                    <span className="switch-track" aria-hidden="true" />
                    All day
                  </label>
                  <label className="switch">
                    <input type="checkbox" checked={showStart} onChange={(e) => toggleStart(e.target.checked)} />
                    <span className="switch-track" aria-hidden="true" />
                    Start date
                  </label>
                </div>
              }
            >
              {showStart && (
                <DateField label="Start date" value={edits.start} allDay={allDay} onChange={(start) => changeDate('start', start)} />
              )}
              <DateField label="Due date" value={edits.due} allDay={allDay} colored onChange={(due) => changeDate('due', due)} />
              <RepeatField value={edits.recurrence} anchor={repeatAnchor} allDay={allDay} onChange={changeRepeat} />
              {edits.recurrence && !edits.start && !edits.due && (
                <p className="repeat-note repeat-note-warning">
                  <RepeatIcon />
                  Without a date, the repeat is removed too.
                </p>
              )}
            </SidebarItem>

            <SidebarItem title="Priority">
              <div className="priority-picker" role="radiogroup" aria-label="Priority">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={edits.priority === p}
                    className={`priority-option p${p}`}
                    aria-label={`Priority ${p}`}
                    title={`Priority ${p}`}
                    onClick={() => update({ priority: p })}
                  >
                    <FlagIcon />
                  </button>
                ))}
              </div>
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
          {task?.recurrence && !task.completed && onCompleteForGood && (
            <button
              type="button"
              className="btn btn-link complete-for-good"
              title="Complete this task and stop repeating it (reopening it brings the repeat back)"
              onClick={() => {
                onCompleteForGood(task);
                onClose();
              }}
            >
              <CheckIcon />
              Complete for good
            </button>
          )}
          <span className="modal-footer-message" role="alert">
            {message}
          </span>
          {task && (
            // The file as stored on the server (reminders, repeats and overrides included), not the unsaved edits.
            <button
              type="button"
              className="icon-btn"
              aria-label="Download as .ics"
              title="Download as .ics (the saved version)"
              onClick={() => download(fileName(task.summary, 'ics', 'task'), task.ics, 'text/calendar')}
            >
              <DownloadIcon />
            </button>
          )}
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

      {askingLeave && (
        <ConfirmDialog
          title={isNew ? 'Add this task?' : 'Save changes?'}
          message={
            dirty && problem
              ? `${problem} Fix it to save, or discard the changes.`
              : isNew
                ? 'This task has not been added yet.'
                : dirty
                  ? 'The changes you made to this task have not been saved.'
                  : 'The sub-task you typed has not been added.'
          }
          confirmLabel={isNew ? 'Add task' : 'Save'}
          confirmDisabled={dirty && Boolean(problem)}
          onConfirm={saveAndLeave}
          onCancel={() => answerLeave(false)}
          alternative={{ label: 'Discard', onClick: () => answerLeave(true) }}
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
  return (
    <div className="date-field">
      <span className="date-field-label">{label}</span>
      <div className="date-field-row">
        <DatePicker
          value={value?.date}
          // The time counts too: a due time already passed today is overdue.
          tone={colored && value ? describeDue(value).tone : undefined}
          clearable
          aria-label={label}
          onChange={(date) => onChange(!date ? undefined : allDay ? { date } : { date, time: value?.time ?? DEFAULT_TIME })}
        />
        {!allDay && (
          <TimeField
            value={value && (value.time ?? DEFAULT_TIME)}
            aria-label={`${label} time`}
            // A time alone means today, as in Todoist.
            onChange={(time) => onChange({ date: value?.date ?? todayDate().date, time })}
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
    </div>
  );
}

function SubtaskRow({ task, onOpen, onToggle }: { task: Task; onOpen?: (task: Task) => void; onToggle: (task: Task) => void }) {
  const due = task.due && describeDue(task.due);
  return (
    <li className={`subtask${task.completed ? ' task-done' : ''}`} onClick={() => onOpen?.(task)}>
      <TaskCheckbox task={task} onToggle={onToggle} />
      <span className="task-title">{task.summary || <span className="muted">Untitled task</span>}</span>
      {due && (
        <span className={`due due-${due.tone}`}>
          {due.label}
          <RepeatMark task={task} />
        </span>
      )}
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
