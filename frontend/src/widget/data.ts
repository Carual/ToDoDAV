import { CalDavClient, CalDavError, type Calendar } from '../api/caldav.ts';
import type { LocalDate } from '../api/ical.ts';
import { parseTask, withCompleted, withNextOccurrence, type Priority, type Task } from '../api/tasks.ts';
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
  /** Ticked, for the moment a second tap can still undo it (drawn only, never cached). */
  ticked?: boolean;
}

/** An open task as stored, so a tick can be saved (and drawn) without reading the list again first. */
interface StoredTask {
  calendarHref: string;
  etag: string;
  ics: string;
}

export interface WidgetSnapshot {
  state: 'ok' | 'loggedOut' | 'noLists';
  title: string;
  /** The list a new task from the widget goes in (absent for "All": the app picks its usual one). */
  calendarHref?: string;
  rows: WidgetRow[];
  /** The lists shown, so reading them again after a tick needn't ask for the lists first. */
  lists?: Calendar[];
  /** Every open task of those lists by href, sub-tasks included (a tick completes them too). */
  stored?: Record<string, StoredTask>;
  /** Why the rows may be out of date (the server could not be reached). */
  problem?: string;
  /** A refresh is running. */
  loading?: boolean;
}

/** Rows past this many are left out: a widget is a glance, and each row costs memory in the launcher. */
const MAX_ROWS = 60;

const listKey = (widgetId: number) => `tododav.widget.${widgetId}.list`;
const cacheKey = (widgetId: number) => `tododav.widget.${widgetId}.cache`;
const tickingKey = (widgetId: number) => `tododav.widget.${widgetId}.ticking`;

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
    localStorage.removeItem(tickingKey(widgetId));
  } catch {
    // Nothing to clean up.
  }
}

/** How long a tick stays undoable (a second tap on the circle) before the row leaves and the save is sent. */
export const TICK_MS = 700;

/**
 * The rows ticked but not saved yet, by href, each with when it was ticked (which also tells one tick from a later
 * one on the same row). Kept in storage because each tap is its own run of the task handler: the run that ticked
 * is still waiting when the tap that undoes it arrives.
 */
export type Ticking = Record<string, number>;

export function readTicking(widgetId: number): Ticking {
  try {
    const raw = readSetting(tickingKey(widgetId));
    const all = raw ? (JSON.parse(raw) as Ticking) : {};
    // A run that died while waiting leaves its entry behind; long past the wait, it no longer counts.
    const live: Ticking = {};
    for (const [href, at] of Object.entries(all)) if (Date.now() - at < TICK_MS + 10_000) live[href] = at;
    return live;
  } catch {
    return {};
  }
}

export function saveTicking(widgetId: number, ticking: Ticking) {
  saveSetting(tickingKey(widgetId), JSON.stringify(ticking));
}

/** The snapshot as drawn: rows ticked but not saved yet show the tick. */
export function withTicks(snapshot: WidgetSnapshot, ticking: Ticking): WidgetSnapshot {
  if (!snapshot.rows.some((r) => r.href in ticking)) return snapshot;
  return { ...snapshot, rows: snapshot.rows.map((r) => (r.href in ticking ? { ...r, ticked: true } : r)) };
}

/** Whether two snapshots draw the same: redrawing a widget makes its list flash and jump back to the top. */
export function looksSame(a: WidgetSnapshot | null, b: WidgetSnapshot): boolean {
  if (!a) return false;
  const shown = (s: WidgetSnapshot) => JSON.stringify([s.state, s.title, s.calendarHref, s.rows, s.problem, Boolean(s.loading)]);
  return shown(a) === shown(b);
}

async function client(): Promise<CalDavClient | null> {
  const login = await readLogin();
  return login && new CalDavClient(login, login.transport);
}

const LOGGED_OUT: WidgetSnapshot = { state: 'loggedOut', title: 'ToDoDAV', rows: [] };

/**
 * Reads the widget's list from the server, and remembers it for next time. `quick`: the lists are taken from the
 * last read rather than asked for again (one request less, right after a tick).
 */
export async function loadSnapshot(widgetId: number, { quick = false } = {}): Promise<WidgetSnapshot> {
  const snapshot = await readSnapshot(widgetId, quick ? readCache(widgetId)?.lists : undefined);
  saveCache(widgetId, snapshot);
  return snapshot;
}

async function readSnapshot(widgetId: number, knownLists?: Calendar[]): Promise<WidgetSnapshot> {
  const caldav = await client();
  if (!caldav) return LOGGED_OUT;
  try {
    let shown = knownLists;
    if (!shown?.length) {
      const { tasks: calendars } = await caldav.discoverCalendars();
      if (calendars.length === 0) return { state: 'noLists', title: 'ToDoDAV', rows: [] };
      // As in the app: "All" when there are several lists and nothing else was picked; a list since removed falls back.
      const choice = readWidgetList(widgetId);
      const picked = calendars.find((c) => c.href === choice);
      shown = picked ? [picked] : choice === ALL_LISTS || calendars.length > 1 ? calendars : [calendars[0]!];
    }
    const several = shown.length > 1;

    // Open tasks only: a list can have thousands of completed ones, which the widget never shows.
    const lists = await Promise.all(
      shown.map(async (calendar) => ({ calendar, tasks: (await caldav.listTasks(calendar.href, { openOnly: true })).filter((t) => !t.completed) })),
    );
    const stored: Record<string, StoredTask> = {};
    for (const { calendar, tasks } of lists) {
      for (const t of tasks) stored[t.href] = { calendarHref: calendar.href, etag: t.etag, ics: t.ics };
    }
    const rows = lists
      .flatMap(({ calendar, tasks }) => {
        // Sub-tasks stay with their parent in the app; the widget lists the top level, as Todoist's does.
        const tree = buildTree(tasks);
        return tasks.filter((t) => !tree.parentOf(t)).map((task) => toRow(task, calendar, several));
      })
      .sort(taskOrder(loadSettings().layout.undatedFirst))
      .slice(0, MAX_ROWS);
    return {
      state: 'ok',
      title: several ? 'All' : shown[0]!.name,
      calendarHref: several ? undefined : shown[0]!.href,
      rows,
      lists: shown,
      stored,
    };
  } catch (error) {
    if (error instanceof CalDavError && error.status === 401) return LOGGED_OUT;
    const cached = readCache(widgetId);
    const problem = 'Could not reach the server';
    return cached ? { ...cached, problem, loading: false } : { state: 'ok', title: 'ToDoDAV', rows: [], problem };
  }
}

function toRow(task: Task, calendar: Calendar, several: boolean): WidgetRow {
  return {
    uid: task.uid,
    href: task.href,
    calendarHref: calendar.href,
    summary: plainText(task.summary) || 'Untitled task',
    due: task.due,
    priority: task.priority,
    recurring: task.recurrence !== undefined,
    labels: task.categories,
    list: several ? { name: calendar.name, color: calendar.color } : undefined,
  };
}

/** A save to make, with the ETag the task was read with. */
interface Save {
  href: string;
  etag: string;
  ics: string;
}

/**
 * Completes a task from what the widget last read, as the app's checkbox does: a repeating task moves to its next
 * occurrence, any other task is completed with its open sub-tasks. Returns what to draw at once (the row gone, or
 * moved to its next date; also remembered) and the saves to run after, or null when the widget doesn't hold the task.
 */
export function completeLocally(widgetId: number, href: string): { snapshot: WidgetSnapshot; saves: Save[]; recurring: boolean } | null {
  const cached = readCache(widgetId);
  const stored = cached?.stored?.[href];
  const row = cached?.rows.find((r) => r.href === href);
  if (!cached?.stored || !stored || !row) return null;

  const task = parseTask(href, stored.etag, stored.ics);
  const next = task.recurrence ? withNextOccurrence(task) : null;
  const remaining = { ...cached.stored };
  let rows: WidgetRow[];
  let saves: Save[];

  if (next) {
    const moved = parseTask(href, stored.etag, next);
    rows = cached.rows.map((r) => (r.href === href ? { ...r, due: moved.due } : r)).sort(taskOrder(loadSettings().layout.undatedFirst));
    remaining[href] = { ...stored, ics: next };
    saves = [{ href, etag: stored.etag, ics: next }];
  } else {
    // Its open sub-tasks, at any depth, from the same list.
    const open = Object.entries(cached.stored)
      .filter(([, s]) => s.calendarHref === stored.calendarHref)
      .map(([h, s]) => parseTask(h, s.etag, s.ics));
    const own = open.find((t) => t.href === href) ?? task;
    const done = [own, ...descendants(buildTree(open), own)];
    rows = cached.rows.filter((r) => r.href !== href);
    saves = done.map((t) => {
      delete remaining[t.href];
      return { href: t.href, etag: t.etag, ics: withCompleted(t, true) };
    });
  }

  const snapshot = { ...cached, rows, stored: remaining, loading: false };
  saveCache(widgetId, snapshot);
  return { snapshot, saves, recurring: next !== null };
}

/**
 * Runs the saves of a tick. If the task changed elsewhere since the widget read it, the tick is done again on what
 * the server has now (fallback below).
 */
export async function saveCompletion(calendarHref: string, href: string, saves: Save[], recurring: boolean): Promise<void> {
  const caldav = await client();
  if (!caldav) return;
  const [main, ...others] = saves;
  if (!main) return;
  try {
    await caldav.saveObject(main, main.ics);
  } catch (error) {
    if (error instanceof CalDavError && error.status === 412) return completeTask(calendarHref, href);
    throw error;
  }
  // A sub-task changed elsewhere stays as it is: the task itself is done.
  await Promise.all(others.map((s) => caldav.saveObject(s, s.ics).catch(() => {})));
  if (recurring) await reopenSubtasks(caldav, calendarHref, href);
}

/** Like Todoist, a repeating task's checklist starts over: its completed sub-tasks open again. */
async function reopenSubtasks(caldav: CalDavClient, calendarHref: string, href: string) {
  // Completed tasks are only read here, after the widget has been drawn: a list can have thousands.
  const tasks = await caldav.listTasks(calendarHref);
  const task = tasks.find((t) => t.href === href);
  if (!task) return;
  const reopen = descendants(buildTree(tasks), task).filter((t) => t.completed);
  await Promise.all(reopen.map((t) => caldav.saveObject(t, withCompleted(t, false)).catch(() => {})));
}

/** The tick, on the tasks as the server has them now: when the widget's copy is missing or out of date. */
export async function completeTask(calendarHref: string, href: string): Promise<void> {
  const caldav = await client();
  if (!caldav) return;
  const tasks = await caldav.listTasks(calendarHref, { openOnly: true });
  const task = tasks.find((t) => t.href === href);
  if (!task || task.completed) return;

  if (task.recurrence) {
    const next = withNextOccurrence(task);
    if (next) {
      await caldav.saveObject(task, next);
      await reopenSubtasks(caldav, calendarHref, href);
      return;
    }
    // No occurrence left (COUNT or UNTIL reached): completed for good, like any task.
  }
  const tree = buildTree(tasks);
  for (const t of [task, ...descendants(tree, task).filter((d) => !d.completed)]) {
    await caldav.saveObject(t, withCompleted(t, true));
  }
}
