import { useEffect, useRef, useState } from 'react';
import type { Task, TaskEdits } from '../api/tasks.ts';
import { navigate, taskPath } from '../router.ts';
import { useTaskList } from '../useTaskList.ts';
import { ChevronDownIcon, LogoMark, PlusIcon, ShareIcon } from './icons.tsx';
import type { Session } from './Login.tsx';
import { ShareModal } from './ShareModal.tsx';
import { Spinner } from './Spinner.tsx';
import { TaskItem } from './TaskItem.tsx';
import { TaskModal } from './TaskModal.tsx';

const SELECTED_KEY = 'tododav.calendar';
const SHOW_COMPLETED_KEY = 'tododav.showCompleted';

interface Toast {
  message: string;
  /** A button in the toast, such as Undo or Retry. */
  action?: { label: string; run: () => void };
}

function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembering the list or the completed section is only a convenience.
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

/** Completed tasks, most recently completed first (tasks without a completion time last). */
function compareCompleted(a: Task, b: Task): number {
  const byCompleted = (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0);
  return byCompleted || a.summary.localeCompare(b.summary);
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
    const saved = readSetting(SELECTED_KEY);
    return calendars.find((c) => c.href === saved)?.href ?? calendars[0]?.href;
  });
  const [showCompleted, setShowCompleted] = useState(() => readSetting(SHOW_COMPLETED_KEY) === 'true');
  const calendar = calendars.find((c) => c.href === calendarHref);

  const [creating, setCreating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function showToast(next: Toast) {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  // Every change shows at once; a failed save puts the task back and says so here.
  const list = useTaskList({
    client,
    calendarHref,
    onLogout,
    onWriteError: ({ message, retry }) => showToast({ message, action: retry && { label: 'Retry', run: retry } }),
  });
  const { tasks } = list;

  function setCompleted(task: Task, completed: boolean) {
    list.setCompleted(task.href, completed);
    if (completed) {
      showToast({ message: 'Task completed', action: { label: 'Undo', run: () => list.setCompleted(task.href, false) } });
    }
  }

  function selectCalendar(href: string) {
    setCalendarHref(href);
    saveSetting(SELECTED_KEY, href);
  }

  function toggleShowCompleted() {
    setShowCompleted(!showCompleted);
    saveSetting(SHOW_COMPLETED_KEY, String(!showCompleted));
  }

  const toggleTask = (task: Task) => setCompleted(task, !task.completed);

  const closeTask = () => navigate('/tasks');

  function saveEdits(task: Task, edits: TaskEdits) {
    list.edit(task.href, edits);
    closeTask();
  }

  function createTask(edits: TaskEdits) {
    if (!calendarHref) return;
    list.create(calendarHref, edits);
    setCreating(false);
  }

  const openTasks = tasks.filter((t) => !t.completed).sort(compareTasks);
  const completedTasks = tasks.filter((t) => t.completed).sort(compareCompleted);
  const openTask = openUid === undefined ? undefined : tasks.find((t) => t.uid === openUid);
  const modalOpen = creating || sharing || openTask !== undefined;

  // A task link can point to another list (the URL has only the UID): look there and switch to it.
  const taskMissing = openUid !== undefined && !openTask && list.fetched;
  const { locate } = list;
  useEffect(() => {
    if (!taskMissing || openUid === undefined) return;
    let cancelled = false;
    void locate(openUid, calendars.filter((c) => c.href !== calendarHref)).then((found) => {
      if (cancelled) return;
      if (found) return selectCalendar(found);
      showToast({ message: 'Task not found' });
      navigate('/tasks', { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [taskMissing, openUid, calendarHref, calendars, locate]);

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

            {list.loadError ? (
              <div className="empty">
                <p className="form-error">{list.loadError}</p>
                <button type="button" className="btn btn-secondary" onClick={list.reload}>
                  Try again
                </button>
              </div>
            ) : !list.loaded ? (
              <div className="loading">
                <Spinner label="Loading tasks" />
              </div>
            ) : (
              <>
                {openTasks.length > 0 && (
                  <ul className="task-list">
                    {openTasks.map((task) => (
                      <TaskItem
                        key={task.href}
                        task={task}
                        onOpen={(t) => navigate(taskPath(t.uid))}
                        onToggle={toggleTask}
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
                {completedTasks.length > 0 && (
                  <section className="completed-section">
                    <button
                      type="button"
                      className="completed-toggle"
                      aria-expanded={showCompleted}
                      onClick={toggleShowCompleted}
                    >
                      <ChevronDownIcon />
                      Completed
                      <span className="completed-count">{completedTasks.length}</span>
                    </button>
                    {showCompleted && (
                      <ul className="task-list">
                        {completedTasks.map((task) => (
                          <TaskItem
                            key={task.href}
                            task={task}
                            onOpen={(t) => navigate(taskPath(t.uid))}
                            onToggle={toggleTask}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
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
          onToggle={toggleTask}
        />
      )}

      {calendar && !creating && openTask && (
        <TaskModal
          // Remount only when the content changes (a reload or a failed save), not when a save just confirms it.
          key={`${openTask.href} ${openTask.ics}`}
          task={openTask}
          calendar={calendar}
          onClose={closeTask}
          onSave={(edits) => saveEdits(openTask, edits)}
          onToggle={toggleTask}
        />
      )}

      {calendar && sharing && (
        <ShareModal client={client} calendar={calendar} feeds={config.feeds} onClose={() => setSharing(false)} />
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action?.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
