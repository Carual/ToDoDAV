import { CalDavClient, CalDavError, type Calendar } from '../api/caldav.ts';
import type { LocalDate } from '../api/ical.ts';
import { withCompleted, withNextOccurrence, type Priority, type Task } from '../api/tasks.ts';
import { plainText } from '../lib/markdown.tsx';
import { taskOrder } from '../lib/taskRows.ts';
import { buildTree, descendants } from '../lib/taskTree.ts';
import { loadSettings, readSetting, saveSetting } from '../lib/viewSettings.ts';
import { readLogin } from '../state/loginStore.ts';

// What the Android home-screen widget shows, read straight from the CalDAV server with the app's saved login. It
// runs in the background (a headless task), without the app's screens or state, so it reads and writes on its own.

/** The widget's choice of list meaning every list, as the app's "All". */
export const ALL_LISTS = 'all';

/** One task row. Dates are kept as dates, so "Today" or "Overdue" is worked out when drawn, not when read. */
export interface WidgetRow {
  uid: string;
  href: string;
  calendarHref: string;
  summary: string;
  due?: LocalDate;
  priority: Priority;
  recurring: boolean;
  labels: string[];
  /** The list's name and color, only where several lists mix. */
  list?: { name: string; color?: string };
  /** Ticked, while its save runs. */
  done?: boolean;
}

export interface WidgetSnapshot {
  state: 'ok' | 'loggedOut' | 'noLists';
  title: string;
  /** The list a new task from the widget goes in (absent for "All": the app picks its usual one). */
  calendarHref?: string;
  rows: WidgetRow[];
  /** Why the rows may be out of date (the server could not be reached). */
  problem?: string;
  /** A refresh is running. */
  loading?: boolean;
}

/** Rows past this many are left out: a widget is a glance, and each row costs memory in the launcher. */
const MAX_ROWS = 60;

const listKey = (widgetId: number) => `tododav.widget.${widgetId}.list`;
const cacheKey = (widgetId: number) => `tododav.widget.${widgetId}.cache`;

export function readWidgetList(widgetId: number): string | null {
  return readSetting(listKey(widgetId));
}

export function saveWidgetList(widgetId: number, list: string) {
  saveSetting(listKey(widgetId), list);
}

/** The last rows shown, drawn at once while fresh ones load (and kept when the server can't be reached). */
export function readCache(widgetId: number): WidgetSnapshot | null {
  try {
    const raw = readSetting(cacheKey(widgetId));
    return raw ? (JSON.parse(raw) as WidgetSnapshot) : null;
  } catch {
    return null;
  }
}

function saveCache(widgetId: number, snapshot: WidgetSnapshot) {
  saveSetting(cacheKey(widgetId), JSON.stringify({ ...snapshot, loading: undefined }));
}

export function forgetWidget(widgetId: number) {
  try {
    localStorage.removeItem(listKey(widgetId));
    localStorage.removeItem(cacheKey(widgetId));
  } catch {
    // Nothing to clean up.
  }
}

async function client(): Promise<CalDavClient | null> {
  const login = await readLogin();
  return login && new CalDavClient(login, login.transport);
}

const LOGGED_OUT: WidgetSnapshot = { state: 'loggedOut', title: 'ToDoDAV', rows: [] };

/** Reads the widget's list from the server, and remembers it for next time. */
export async function loadSnapshot(widgetId: number): Promise<WidgetSnapshot> {
  const snapshot = await readSnapshot(widgetId);
  saveCache(widgetId, snapshot);
  return snapshot;
}

async function readSnapshot(widgetId: number): Promise<WidgetSnapshot> {
  const caldav = await client();
  if (!caldav) return LOGGED_OUT;
  try {
    const { tasks: calendars } = await caldav.discoverCalendars();
    if (calendars.length === 0) return { state: 'noLists', title: 'ToDoDAV', rows: [] };

    // As in the app: "All" when there are several lists and nothing else was picked; a list since removed falls back.
    const choice = readWidgetList(widgetId);
    const picked = calendars.find((c) => c.href === choice);
    const shown: Calendar[] = picked ? [picked] : choice === ALL_LISTS || calendars.length > 1 ? calendars : [calendars[0]!];
    const several = shown.length > 1;

    // Open tasks only: a list can have thousands of completed ones, which the widget never shows.
    const lists = await Promise.all(shown.map(async (calendar) => ({ calendar, tasks: await caldav.listTasks(calendar.href, { openOnly: true }) })));
    const compare = taskOrder(loadSettings().layout.undatedFirst);
    const rows = lists
      .flatMap(({ calendar, tasks }) => {
        const open = tasks.filter((t) => !t.completed);
        // Sub-tasks stay with their parent in the app; the widget lists the top level, as Todoist's does.
        const tree = buildTree(open);
        return open.filter((t) => !tree.parentOf(t)).map((task) => ({ task, calendar }));
      })
      .sort((a, b) => compare(a.task, b.task))
      .slice(0, MAX_ROWS)
      .map(({ task, calendar }): WidgetRow => ({
        uid: task.uid,
        href: task.href,
        calendarHref: calendar.href,
        summary: plainText(task.summary) || 'Untitled task',
        due: task.due,
        priority: task.priority,
        recurring: task.recurrence !== undefined,
        labels: task.categories,
        list: several ? { name: calendar.name, color: calendar.color } : undefined,
      }));
    return {
      state: 'ok',
      title: several ? 'All' : shown[0]!.name,
      calendarHref: several ? undefined : shown[0]!.href,
      rows,
    };
  } catch (error) {
    if (error instanceof CalDavError && error.status === 401) return LOGGED_OUT;
    const cached = readCache(widgetId);
    const problem = 'Could not reach the server';
    return cached ? { ...cached, problem, loading: false } : { state: 'ok', title: 'ToDoDAV', rows: [], problem };
  }
}

/** The snapshot with one row ticked, drawn while the task is completed on the server. */
export function withRowDone(snapshot: WidgetSnapshot, href: string): WidgetSnapshot {
  return { ...snapshot, rows: snapshot.rows.map((row) => (row.href === href ? { ...row, done: true } : row)) };
}

/**
 * Completes a task as the app's checkbox does: a repeating task moves to its next occurrence (and its completed
 * sub-tasks open again), any other task is completed with its open sub-tasks.
 */
export async function completeTask(calendarHref: string, href: string, recurring: boolean): Promise<void> {
  const caldav = await client();
  if (!caldav) return;
  // Fresh from the server, so the saves carry current ETags. Completed tasks only matter for a repeating task.
  const tasks = await caldav.listTasks(calendarHref, { openOnly: !recurring });
  const task = tasks.find((t) => t.href === href);
  if (!task || task.completed) return;
  const tree = buildTree(tasks);
  const save = (t: Task, ics: string) => caldav.saveObject(t, ics);

  if (task.recurrence) {
    const next = withNextOccurrence(task);
    if (next) {
      await save(task, next);
      for (const t of descendants(tree, task).filter((d) => d.completed)) await save(t, withCompleted(t, false));
      return;
    }
    // No occurrence left (COUNT or UNTIL reached): completed for good, like any task.
  }
  for (const t of [task, ...descendants(tree, task).filter((d) => !d.completed)]) await save(t, withCompleted(t, true));
}
