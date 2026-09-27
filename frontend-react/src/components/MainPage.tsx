import { useCallback, useEffect, useRef, useState } from 'react';
import { CalDavError } from '../api/caldav.ts';
import { applyEdits, newTaskIcs, withCompleted, type Task, type TaskEdits } from '../api/tasks.ts';
import { navigate, taskPath } from '../router.ts';
import { ChevronDownIcon, LogoMark, PlusIcon, ShareIcon } from './icons.tsx';
import type { Session } from './Login.tsx';
import { ShareModal } from './ShareModal.tsx';
import { TaskItem } from './TaskItem.tsx';
import { TaskModal } from './TaskModal.tsx';

const SELECTED_KEY = 'tododav.calendar';

interface Toast {
  message: string;
  undo?: () => void;
}

function readSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

function saveSelected(href: string) {
  try {
    localStorage.setItem(SELECTED_KEY, href);
  } catch {
    // Remembering the list is only a convenience.
  }
}

/** Open tasks by due date (undated last), then by priority, then by name. */
function compareTasks(a: Task, b: Task): number {
  if (a.due && !b.due) return -1;
  if (!a.due && b.due) return 1;
  // ISO dates compare correctly as plain strings; all-day tasks go after timed ones on the same day.
  const dueA = a.due ? `${a.due.date} ${a.due.time ?? '99:99'}` : '';
  const dueB = b.due ? `${b.due.date} ${b.due.time ?? '99:99'}` : '';
  const byDue = dueA < dueB ? -1 : dueA > dueB ? 1 : 0;
  return byDue || a.priority - b.priority || a.summary.localeCompare(b.summary);
}

interface Props {
  session: Session;
  /** UID of the task whose modal is open, from the URL (/tasks/<uid>). */
  openUid?: string;
  onLogout: () => void;
}

export function MainPage({ session, openUid, onLogout }: Props) {
  const { client, calendars, config } = session;
  const canShare = config.feeds.tasks || config.feeds.events;
  const [calendarHref, setCalendarHref] = useState(() => {
    const saved = readSelected();
    return calendars.find((c) => c.href === saved)?.href ?? calendars[0]?.href;
  });
  const calendar = calendars.find((c) => c.href === calendarHref);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The list `tasks` belongs to, once loaded; until then a missing task may just not be loaded yet. */
  const [loadedHref, setLoadedHref] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const loadId = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    if (!calendarHref) return;
    const id = ++loadId.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await client.listTasks(calendarHref);
      if (id === loadId.current) {
        setTasks(result);
        setLoadedHref(calendarHref);
      }
    } catch (err) {
      if (err instanceof CalDavError && err.status === 401) return onLogout();
      if (id === loadId.current) setLoadError(err instanceof Error ? err.message : 'Could not load the tasks.');
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [client, calendarHref, onLogout]);

  useEffect(() => {
    void load();
  }, [load]);

  function showToast(next: Toast) {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  function replaceTask(saved: Task) {
    setTasks((current) => current.map((t) => (t.href === saved.href ? saved : t)));
  }

  /** Saves new iCalendar text; on a conflict (412) the list is reloaded so the next try uses fresh data. */
  async function persist(task: Task, ics: string): Promise<Task> {
    try {
      const saved = await client.saveTask(task, ics);
      if (saved.etag) replaceTask(saved);
      else void load(); // the server did not send the new ETag: reload to get it
      return saved;
    } catch (err) {
      if (err instanceof CalDavError && err.status === 412) void load();
      throw err;
    }
  }

  async function setCompleted(task: Task, completed: boolean) {
    replaceTask({ ...task, completed }); // optimistic: hide or show it right away
    try {
      const saved = await persist(task, withCompleted(task, completed));
      if (completed) showToast({ message: 'Task completed', undo: () => void setCompleted(saved, false) });
    } catch (err) {
      replaceTask(task);
      showToast({ message: err instanceof Error ? err.message : 'Could not update the task.' });
    }
  }

  function selectCalendar(href: string) {
    setCalendarHref(href);
    saveSelected(href);
  }

  const closeTask = () => navigate('/tasks');

  async function saveEdits(task: Task, edits: TaskEdits) {
    await persist(task, applyEdits(task, edits));
    closeTask();
  }

  async function createTask(edits: TaskEdits) {
    if (!calendarHref) return;
    const { uid, ics } = newTaskIcs(edits);
    const created = await client.createTask(calendarHref, uid, ics);
    if (created.etag) setTasks((current) => [...current, created]);
    else void load(); // the server did not send the ETag: reload to get it
    setCreating(false);
  }

  const openTasks = tasks.filter((t) => !t.completed).sort(compareTasks);
  const openTask = openUid === undefined ? undefined : tasks.find((t) => t.uid === openUid);
  const modalOpen = creating || sharing || openTask !== undefined;

  // A task link can point to another list (the URL has only the UID): look there and switch to it.
  const taskMissing = openUid !== undefined && !openTask && loadedHref === calendarHref;
  useEffect(() => {
    if (!taskMissing) return;
    let cancelled = false;
    void (async () => {
      for (const other of calendars) {
        if (other.href === calendarHref) continue;
        const found = await client.listTasks(other.href).then(
          (list) => list.some((t) => t.uid === openUid),
          () => false, // an unreadable list just is not where the task is
        );
        if (cancelled) return;
        if (found) return selectCalendar(other.href);
      }
      if (cancelled) return;
      showToast({ message: 'Task not found' });
      navigate('/tasks', { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [taskMissing, openUid, calendarHref, calendars, client]);

  // "Q" opens the new-task modal, like Todoist's quick add (not while typing or with a modal open).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key.toLowerCase() !== 'q' || event.ctrlKey || event.metaKey || event.altKey || typing) return;
      if (modalOpen || !calendar) return;
      event.preventDefault();
      setCreating(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen, calendar]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand brand-small">
          <LogoMark className="brand-mark" />
          ToDoDAV
        </div>
        <div className="account">
          <span className="avatar" aria-hidden="true">
            {client.username.slice(0, 1).toUpperCase()}
          </span>
          <span className="account-name">{client.username}</span>
          <button type="button" className="btn btn-link" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>

      <main className="content">
        {!calendar ? (
          <div className="empty">
            <h2>No task lists found</h2>
            <p>Create a calendar with tasks (VTODO) on your CalDAV server, then log in again.</p>
          </div>
        ) : (
          <>
            <div className="view-header">
              <h1>{calendar.name}</h1>
              <div className="view-actions">
                {canShare && (
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
                {calendars.length > 1 && (
                  <label className="calendar-select">
                    <span className="visually-hidden">Task list</span>
                    <select
                      value={calendar.href}
                      onChange={(e) => selectCalendar(e.target.value)}
                    >
                      {calendars.map((c) => (
                        <option key={c.href} value={c.href}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon />
                  </label>
                )}
              </div>
            </div>

            {loadError ? (
              <div className="empty">
                <p className="form-error">{loadError}</p>
                <button type="button" className="btn btn-secondary" onClick={() => void load()}>
                  Try again
                </button>
              </div>
            ) : loading && tasks.length === 0 ? (
              <p className="muted loading">Loading tasks…</p>
            ) : (
              <>
                {openTasks.length > 0 && (
                  <ul className="task-list">
                    {openTasks.map((task) => (
                      <TaskItem
                        key={task.href}
                        task={task}
                        onOpen={(t) => navigate(taskPath(t.uid))}
                        onComplete={(t) => void setCompleted(t, true)}
                      />
                    ))}
                  </ul>
                )}
                <button type="button" className="add-task" onClick={() => setCreating(true)}>
                  <span className="add-task-icon" aria-hidden="true">
                    <PlusIcon />
                  </span>
                  Add task
                </button>
                {openTasks.length === 0 && (
                  <div className="empty">
                    <h2>All clear</h2>
                    <p>No open tasks in this list.</p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      {calendar && creating && (
        <TaskModal
          key="new"
          calendar={calendar}
          onClose={() => setCreating(false)}
          onSave={createTask}
          onComplete={(t) => void setCompleted(t, true)}
        />
      )}

      {calendar && !creating && openTask && (
        <TaskModal
          key={`${openTask.href} ${openTask.etag}`}
          task={openTask}
          calendar={calendar}
          onClose={closeTask}
          onSave={(edits) => saveEdits(openTask, edits)}
          onComplete={(t) => void setCompleted(t, true)}
        />
      )}

      {calendar && sharing && (
        <ShareModal client={client} calendar={calendar} feeds={config.feeds} onClose={() => setSharing(false)} />
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
