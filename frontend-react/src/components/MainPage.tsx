import { useCallback, useEffect, useRef, useState } from 'react';
import { CalDavError } from '../api/caldav.ts';
import { applyEdits, withCompleted, type Task, type TaskEdits } from '../api/tasks.ts';
import { ChevronDownIcon, LogoMark } from './icons.tsx';
import type { Session } from './Login.tsx';
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

export function MainPage({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const { client, calendars } = session;
  const [calendarHref, setCalendarHref] = useState(() => {
    const saved = readSelected();
    return calendars.find((c) => c.href === saved)?.href ?? calendars[0]?.href;
  });
  const calendar = calendars.find((c) => c.href === calendarHref);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openHref, setOpenHref] = useState<string | null>(null);
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
      if (id === loadId.current) setTasks(result);
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

  async function saveEdits(task: Task, edits: TaskEdits) {
    await persist(task, applyEdits(task, edits));
    setOpenHref(null);
  }

  const openTasks = tasks.filter((t) => !t.completed).sort(compareTasks);
  const openTask = tasks.find((t) => t.href === openHref);

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
              {calendars.length > 1 && (
                <label className="calendar-select">
                  <span className="visually-hidden">Task list</span>
                  <select
                    value={calendar.href}
                    onChange={(e) => {
                      setCalendarHref(e.target.value);
                      saveSelected(e.target.value);
                    }}
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

            {loadError ? (
              <div className="empty">
                <p className="form-error">{loadError}</p>
                <button type="button" className="btn btn-secondary" onClick={() => void load()}>
                  Try again
                </button>
              </div>
            ) : loading && tasks.length === 0 ? (
              <p className="muted loading">Loading tasks…</p>
            ) : openTasks.length === 0 ? (
              <div className="empty">
                <h2>All clear</h2>
                <p>No open tasks in this list.</p>
              </div>
            ) : (
              <ul className="task-list">
                {openTasks.map((task) => (
                  <TaskItem
                    key={task.href}
                    task={task}
                    onOpen={(t) => setOpenHref(t.href)}
                    onComplete={(t) => void setCompleted(t, true)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      {openTask && calendar && (
        <TaskModal
          key={`${openTask.href} ${openTask.etag}`}
          task={openTask}
          calendar={calendar}
          onClose={() => setOpenHref(null)}
          onSave={saveEdits}
          onComplete={(t) => void setCompleted(t, true)}
        />
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
