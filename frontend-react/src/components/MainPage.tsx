import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task, TaskEdits } from '../api/tasks.ts';
import { navigate, taskPath } from '../router.ts';
import { ancestors, buildTree, descendants, type TaskTree } from '../taskTree.ts';
import { useTaskList } from '../useTaskList.ts';
import {
  DEFAULT_SETTINGS,
  describeFilters,
  filtersActive,
  loadSettings,
  matchesFilters,
  readSetting,
  saveSetting,
  saveSettings,
  type Filters,
  type ViewSettings,
} from '../viewSettings.ts';
import { FilterModal } from './FilterModal.tsx';
import { ChevronDownIcon, FilterIcon, GearIcon, LogoMark, PlusIcon, ShareIcon } from './icons.tsx';
import type { Session } from './Login.tsx';
import { SettingsModal } from './SettingsModal.tsx';
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

type Compare = (a: Task, b: Task) => number;

/** Open tasks by due date (undated ones last, or first if asked), then by priority, then by name. */
function taskOrder(undatedFirst: boolean): Compare {
  return (a, b) => {
    if (!a.due !== !b.due) return (a.due ? -1 : 1) * (undatedFirst ? -1 : 1);
    // ISO dates compare correctly as plain strings; all-day tasks go after timed ones on the same day.
    const dueA = a.due ? `${a.due.date} ${a.due.time ?? '99:99'}` : '';
    const dueB = b.due ? `${b.due.date} ${b.due.time ?? '99:99'}` : '';
    const byDue = dueA < dueB ? -1 : dueA > dueB ? 1 : 0;
    return byDue || a.priority - b.priority || a.summary.localeCompare(b.summary);
  };
}

/** Completed tasks, most recently completed first (tasks without a completion time last). */
function compareCompleted(a: Task, b: Task): number {
  const byCompleted = (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0);
  return byCompleted || a.summary.localeCompare(b.summary);
}

interface Row {
  task: Task;
  depth: number;
}

/** How the open tasks are listed, from the settings. */
interface ListView {
  matches: (task: Task) => boolean;
  compare: Compare;
  /** Sub-tasks under their parent; otherwise every open task at the top level. */
  nested: boolean;
}

/**
 * Open tasks in display order, each sub-task right under its parent. An open sub-task of a completed
 * parent (possible when another app completed the parent) shows at the top level instead. When the
 * filters leave a task out, its matching sub-tasks take its place.
 */
function openRows(tasks: Task[], tree: TaskTree, collapsed: ReadonlySet<string>, view: ListView): Row[] {
  const { matches, compare } = view;
  if (!view.nested) {
    return tasks.filter((t) => !t.completed && matches(t)).sort(compare).map((task) => ({ task, depth: 0 }));
  }
  const rows: Row[] = [];
  const visit = (task: Task, depth: number) => {
    if (!matches(task)) {
      for (const child of openChildren(tree, task, compare)) visit(child, depth);
      return;
    }
    rows.push({ task, depth });
    if (collapsed.has(task.uid)) return;
    for (const child of openChildren(tree, task, compare)) visit(child, depth + 1);
  };
  const isRoot = (task: Task) => !tree.parentOf(task) || tree.parentOf(task)!.completed;
  tasks.filter((t) => !t.completed && isRoot(t)).sort(compare).forEach((t) => visit(t, 0));
  return rows;
}

const openChildren = (tree: TaskTree, task: Task, compare: Compare) =>
  tree.childrenOf(task).filter((t) => !t.completed).sort(compare);

/** Whether any open task below this one would show, so its chevron has something to hide. */
function hasShownChildren(tree: TaskTree, task: Task, view: ListView): boolean {
  if (!view.nested) return false;
  return openChildren(tree, task, view.compare).some((child) => view.matches(child) || hasShownChildren(tree, child, view));
}

/** Direct sub-tasks: open ones first in list order, then completed ones. */
const sortedChildren = (tree: TaskTree, task: Task, compare: Compare) => [
  ...openChildren(tree, task, compare),
  ...tree.childrenOf(task).filter((t) => t.completed).sort(compareCompleted),
];

function subtaskCount(tree: TaskTree, task: Task) {
  const children = tree.childrenOf(task);
  return { done: children.filter((t) => t.completed).length, total: children.length };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

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
  const [editingSettings, setEditingSettings] = useState(false);
  const [editingFilters, setEditingFilters] = useState(false);
  const [settings, setSettings] = useState(loadSettings);

  function changeSettings(next: ViewSettings) {
    setSettings(next);
    saveSettings(next);
  }

  const changeFilters = (filters: Filters) => changeSettings({ ...settings, filters });

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
  const tree = useMemo(() => buildTree(tasks), [tasks]);
  /** UIDs of the tasks whose sub-tasks are hidden in the list. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  function toggleCollapsed(uid: string) {
    const next = new Set(collapsed);
    if (!next.delete(uid)) next.add(uid);
    setCollapsed(next);
  }

  function setCompleted(task: Task, completed: boolean) {
    if (!completed) {
      // A sub-task reopened under a completed parent would be cut off from it: reopen the parents too.
      for (const t of [task, ...ancestors(tree, task).filter((a) => a.completed)]) list.setCompleted(t.href, false);
      return;
    }
    // Like Todoist, completing a task completes its open sub-tasks; Undo reopens exactly those.
    const done = [task, ...descendants(tree, task).filter((t) => !t.completed)];
    for (const t of done) list.setCompleted(t.href, true);
    const extra = done.length - 1;
    showToast({
      message: extra > 0 ? `Task and ${plural(extra, 'sub-task')} completed` : 'Task completed',
      action: { label: 'Undo', run: () => done.forEach((t) => list.setCompleted(t.href, false)) },
    });
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

  const openTaskPage = (task: Task) => navigate(taskPath(task.uid));
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

  function addSubtask(parent: Task, summary: string) {
    if (!calendarHref) return;
    list.create(calendarHref, { summary, description: '', priority: 4, categories: [], location: '' }, parent.uid);
  }

  const { filters } = settings;
  const filtered = filtersActive(filters);
  const view: ListView = {
    matches: (task) => matchesFilters(task, filters),
    compare: taskOrder(settings.layout.undatedFirst),
    nested: settings.layout.nestSubtasks,
  };
  const fields = settings.fields.filter((f) => f.visible).map((f) => f.field);
  const labels = useMemo(() => [...new Set(tasks.flatMap((t) => t.categories))].sort((a, b) => a.localeCompare(b)), [tasks]);

  const openTasks = openRows(tasks, tree, collapsed, view);
  const completedTasks = tasks.filter((t) => t.completed && view.matches(t)).sort(compareCompleted);
  const openTask = openUid === undefined ? undefined : tasks.find((t) => t.uid === openUid);
  const modalOpen = creating || sharing || editingSettings || editingFilters || openTask !== undefined;

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
          <button
            type="button"
            className="icon-btn"
            aria-label="Settings"
            title="Settings"
            onClick={() => setEditingSettings(true)}
          >
            <GearIcon />
          </button>
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
              <div className="view-title">
                <h1>{calendar.name}</h1>
                <button
                  type="button"
                  className={`icon-btn${filtered ? ' icon-btn-active' : ''}`}
                  aria-label={filtered ? 'Filters (on)' : 'Filters'}
                  title="Filters"
                  onClick={() => setEditingFilters(true)}
                >
                  <FilterIcon />
                </button>
              </div>
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

            {filtered && (
              <div className="filter-bar">
                <button type="button" className="filter-summary" onClick={() => setEditingFilters(true)}>
                  Filtered: {describeFilters(filters).join(' · ')}
                </button>
                <button type="button" className="btn btn-link" onClick={() => changeFilters(DEFAULT_SETTINGS.filters)}>
                  Clear
                </button>
              </div>
            )}

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
                    {openTasks.map(({ task, depth }) => (
                      <TaskItem
                        key={task.href}
                        task={task}
                        depth={depth}
                        subtasks={subtaskCount(tree, task)}
                        fields={fields}
                        collapsed={collapsed.has(task.uid)}
                        onToggleCollapsed={
                          hasShownChildren(tree, task, view) ? () => toggleCollapsed(task.uid) : undefined
                        }
                        onOpen={openTaskPage}
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
                {openTasks.length === 0 &&
                  (filtered ? (
                    <div className="empty">
                      <h2>No matching tasks</h2>
                      <p>No open tasks in this list match the filters.</p>
                    </div>
                  ) : (
                    <div className="empty">
                      <h2>All clear</h2>
                      <p>No open tasks in this list.</p>
                    </div>
                  ))}
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
                            fields={fields}
                            onOpen={openTaskPage}
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
          showMap={settings.showMap}
        />
      )}

      {calendar && !creating && openTask && (
        <TaskModal
          // Remount only when the content changes (a reload or a failed save), not when a save just confirms it.
          key={`${openTask.href} ${openTask.ics}`}
          task={openTask}
          parent={tree.parentOf(openTask)}
          subtasks={sortedChildren(tree, openTask, view.compare)}
          calendar={calendar}
          onClose={closeTask}
          onSave={(edits) => saveEdits(openTask, edits)}
          onToggle={toggleTask}
          onOpenTask={openTaskPage}
          onAddSubtask={(summary) => addSubtask(openTask, summary)}
          showMap={settings.showMap}
        />
      )}

      {calendar && sharing && (
        <ShareModal client={client} calendar={calendar} feeds={config.feeds} onClose={() => setSharing(false)} />
      )}

      {editingSettings && (
        <SettingsModal settings={settings} onChange={changeSettings} onClose={() => setEditingSettings(false)} />
      )}

      {editingFilters && (
        <FilterModal
          filters={filters}
          labels={labels}
          onChange={changeFilters}
          onClose={() => setEditingFilters(false)}
        />
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
