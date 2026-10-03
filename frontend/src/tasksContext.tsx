import { useRouter } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { Calendar } from './api/caldav.ts';
import type { Task, TaskEdits } from './api/tasks.ts';
import type { ToastMessage } from './components/Toast.tsx';
import { describeDue } from './format.ts';
import { useLoggedIn } from './session.tsx';
import { plural, taskOrder, type ListView } from './taskRows.ts';
import { ancestors, buildTree, descendants, joinTrees, type TaskTree } from './taskTree.ts';
import { useTaskList } from './useTaskList.ts';
import { loadSettings, matchesFilters, readSetting, saveSetting, saveSettings, type ViewSettings } from './viewSettings.ts';

const SELECTED_KEY = 'tododav.calendar';
/** The "All" view's value where a list href would go; hrefs start with / or a scheme, so it can't clash. */
export const ALL = 'all';

/**
 * Everything about the tasks on screen, shared by the list (/tasks) and the task page (/tasks/<uid>) on top of it,
 * as frontend-react's MainPage held it.
 */
function useTasksState() {
  const router = useRouter();
  const { client, calendars, signOut } = useLoggedIn();

  // "All" only makes sense with several lists, and is where the app starts then, like Todoist's all-projects views.
  const canShowAll = calendars.length > 1;
  const [selected, setSelected] = useState(() => {
    const saved = readSetting(SELECTED_KEY);
    if (saved === ALL && canShowAll) return ALL;
    return calendars.find((c) => c.href === saved)?.href ?? (canShowAll ? ALL : calendars[0]?.href);
  });
  const allView = selected === ALL;
  /** The single list on screen; undefined in the "All" view. */
  const calendar = calendars.find((c) => c.href === selected);
  const shownHrefs = allView ? calendars.map((c) => c.href) : calendar ? [calendar.href] : [];

  const [settings, setSettings] = useState(loadSettings);

  function changeSettings(next: ViewSettings) {
    setSettings(next);
    saveSettings(next);
  }

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function showToast(next: ToastMessage) {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Every change shows at once; a failed save puts the task back and says so here.
  const list = useTaskList({
    client,
    calendarHrefs: shownHrefs,
    onLogout: signOut,
    onWriteError: ({ message, retry }) => showToast({ message, action: retry && { label: 'Retry', run: retry } }),
  });
  const { groups } = list;
  const tree: TaskTree = useMemo(() => joinTrees(groups.map(buildTree)), [groups]);
  const calendarOf = (task: Task): Calendar | undefined => calendars.find((c) => c.href === list.listOf(task));

  const view: ListView = {
    matches: (task) => matchesFilters(task, settings.filters),
    compare: taskOrder(settings.layout.undatedFirst),
    nested: settings.layout.nestSubtasks,
  };

  /** `forGood` completes a repeating task instead of moving it to its next date. */
  function setCompleted(task: Task, completed: boolean, forGood = false) {
    if (!completed) {
      // A sub-task reopened under a completed parent would be cut off from it: reopen the parents too.
      for (const t of [task, ...ancestors(tree, task).filter((a) => a.completed)]) list.setCompleted(t.href, false);
      return;
    }
    if (task.recurrence && !forGood) {
      const before = task.ics;
      // Like Todoist, a repeating task's checklist starts over: its completed sub-tasks open again.
      const reopened = descendants(tree, task).filter((t) => t.completed);
      const moved = list.advance(task.href);
      if (moved) {
        for (const t of reopened) list.setCompleted(t.href, false);
        const next = moved.due ?? moved.start;
        showToast({
          message: next ? `Task completed. Next: ${describeDue(next).label}` : 'Task completed',
          action: {
            label: 'Undo',
            run: () => {
              list.restore(task.href, before);
              for (const t of reopened) list.setCompleted(t.href, true);
            },
          },
        });
        return;
      }
      // No occurrence left (COUNT or UNTIL reached): completed for good, like any task.
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

  /** Like Todoist, deleting a task deletes its sub-tasks too; Undo stores them all again as they were. */
  function deleteTask(task: Task) {
    const doomed = [task, ...descendants(tree, task)].flatMap((t) => {
      const listHref = list.listOf(t);
      return listHref ? [{ task: t, listHref }] : [];
    });
    for (const { task: t } of doomed) list.delete(t.href);
    const extra = doomed.length - 1;
    showToast({
      message: extra > 0 ? `Task and ${plural(extra, 'sub-task')} deleted` : 'Task deleted',
      action: { label: 'Undo', run: () => doomed.forEach(({ task: t, listHref }) => list.undelete(listHref, t)) },
    });
  }

  function addSubtask(parent: Task, summary: string) {
    // In the parent's own list: sub-tasks only nest under a parent in the same list.
    const calendarHref = list.listOf(parent);
    if (!calendarHref) return;
    list.create(calendarHref, { summary, description: '', priority: 4, categories: [], location: '' }, parent.uid);
  }

  /** Shows one list, or every list with ALL. */
  function selectCalendar(href: string) {
    setSelected(href);
    saveSetting(SELECTED_KEY, href);
  }

  return {
    client,
    calendars,
    selected,
    allView,
    calendar,
    canShowAll,
    selectCalendar,
    settings,
    changeSettings,
    toast,
    showToast,
    dismissToast: () => setToast(null),
    list,
    tree,
    view,
    calendarOf,
    setCompleted,
    toggleTask: (task: Task) => setCompleted(task, !task.completed),
    deleteTask,
    addSubtask,
    saveEdits: (task: Task, edits: TaskEdits) => list.edit(task.href, edits),
    createTask: (edits: TaskEdits, calendarHref: string) => list.create(calendarHref, edits),
    /** Where a new task goes unless the modal picks another list. */
    newTaskCalendar: calendar ?? calendars[0],
    openTask: (task: Task) => router.push({ pathname: '/tasks/[uid]', params: { uid: task.uid } }),
  };
}

type TasksState = ReturnType<typeof useTasksState>;

const TasksContext = createContext<TasksState | null>(null);

export function TasksProvider({ children }: { children: ReactNode }) {
  const state = useTasksState();
  return <TasksContext.Provider value={state}>{children}</TasksContext.Provider>;
}

export function useTasks(): TasksState {
  const state = useContext(TasksContext);
  if (!state) throw new Error('useTasks must be used inside TasksProvider.');
  return state;
}
