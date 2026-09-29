import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalDavError, type CalDavClient, type Calendar } from './api/caldav.ts';
import {
  applyEdits,
  newTaskIcs,
  parseTask,
  restoredTo,
  withCompleted,
  withNextOccurrence,
  type Task,
  type TaskEdits,
} from './api/tasks.ts';

export interface WriteError {
  message: string;
  /** Present when the server was not reached, so trying again can still work. */
  retry?: () => void;
}

/** A save that failed, with the task as the server last confirmed it (null: it was never created). */
class WriteFailure {
  readonly confirmed: Task | null;
  readonly error: unknown;

  constructor(confirmed: Task | null, error: unknown) {
    this.confirmed = confirmed;
    this.error = error;
  }
}

/** Tasks per list href. */
type Lists = Record<string, Task[]>;

const NO_TASKS: Task[] = [];

function mapLists(lists: Lists, update: (tasks: Task[]) => Task[]): Lists {
  return Object.fromEntries(Object.entries(lists).map(([href, tasks]) => [href, update(tasks)]));
}

interface Options {
  client: CalDavClient;
  /** The lists on screen: one, or every list in the "All" view. */
  calendarHrefs: string[];
  onLogout: () => void;
  onWriteError: (error: WriteError) => void;
}

/**
 * The tasks of every list seen so far, changed optimistically: a change shows at once and is saved in the
 * background. If the save fails, the task goes back to what the server has. Lists seen before are shown
 * from memory while a fresh copy loads, so switching lists is instant too.
 */
export function useTaskList({ client, calendarHrefs, onLogout, onWriteError }: Options) {
  const [lists, setListsState] = useState<Lists>({});
  // The same lists, readable right after a change (before React re-renders) and from old closures like Undo.
  const listsRef = useRef<Lists>({});
  /** Lists fetched from the server at least once, not only built up locally. */
  const [fetched, setFetched] = useState<ReadonlySet<string>>(() => new Set());
  /** Why the last load of a list failed, per list href. */
  const [loadErrors, setLoadErrors] = useState<Readonly<Record<string, string>>>({});
  const loadIds = useRef(new Map<string, number>());
  /**
   * Saves still on their way, per task href; each resolves to the task as the server then has it. Saves to
   * one task go one at a time, each with the ETag the previous one got back, so quick successive changes
   * (edit, complete, Undo) never trip If-Match on each other.
   */
  const pending = useRef(new Map<string, Promise<Task>>());
  const callbacks = useRef({ onLogout, onWriteError });
  useEffect(() => {
    callbacks.current = { onLogout, onWriteError };
  });

  const setLists = useCallback((update: (lists: Lists) => Lists) => {
    listsRef.current = update(listsRef.current);
    setListsState(listsRef.current);
  }, []);

  /** Fresh tasks from the server, keeping the local version of those with a save still in flight. */
  const withPending = useCallback((local: Task[] | undefined, fresh: Task[]): Task[] => {
    const inFlight = (local ?? NO_TASKS).filter((t) => pending.current.has(t.href));
    const freshHrefs = new Set(fresh.map((t) => t.href));
    return [
      ...fresh.map((t) => inFlight.find((l) => l.href === t.href) ?? t),
      ...inFlight.filter((t) => !freshHrefs.has(t.href)), // created here, not stored yet
    ];
  }, []);

  const load = useCallback(
    async (href: string) => {
      const id = (loadIds.current.get(href) ?? 0) + 1;
      loadIds.current.set(href, id);
      setLoadErrors((current) => {
        if (!(href in current)) return current;
        const { [href]: _cleared, ...others } = current;
        return others;
      });
      try {
        const fresh = await client.listTasks(href);
        if (loadIds.current.get(href) !== id) return; // a newer load of this list wins
        setLists((current) => ({ ...current, [href]: withPending(current[href], fresh) }));
        setFetched((current) => new Set(current).add(href));
      } catch (err) {
        if (err instanceof CalDavError && err.status === 401) return callbacks.current.onLogout();
        if (loadIds.current.get(href) !== id) return;
        const message = err instanceof Error ? err.message : 'Could not load the tasks.';
        setLoadErrors((current) => ({ ...current, [href]: message }));
      }
    },
    [client, setLists, withPending],
  );

  // Hrefs never hold a newline, so the joined key only changes when the lists on screen do.
  const shownKey = calendarHrefs.join('\n');
  const shown = useMemo(() => (shownKey ? shownKey.split('\n') : []), [shownKey]);

  useEffect(() => {
    for (const href of shown) void load(href);
  }, [shown, load]);

  /** The tasks on screen, one group per list, so sub-tasks only nest within their own list. */
  const groups = useMemo(() => shown.map((href) => lists[href] ?? NO_TASKS), [shown, lists]);
  const tasks = useMemo(() => groups.flat(), [groups]);
  /** Which list each task on screen is in, by task href. */
  const listByTask = useMemo(
    () => new Map(shown.flatMap((list) => (lists[list] ?? NO_TASKS).map((t) => [t.href, list] as const))),
    [shown, lists],
  );

  const find = (href: string) => Object.values(listsRef.current).flat().find((t) => t.href === href);
  const listOf = (href: string) =>
    Object.keys(listsRef.current).find((list) => listsRef.current[list]!.some((t) => t.href === href));

  const replace = (task: Task) =>
    setLists((current) => mapLists(current, (tasks) => tasks.map((t) => (t.href === task.href ? task : t))));
  const remove = (href: string) => setLists((current) => mapLists(current, (tasks) => tasks.filter((t) => t.href !== href)));

  /**
   * Saves `ics` as the task's content once the saves before it are done. `confirmedNow` is the task as the
   * server has it when nothing is queued (null for a task not created yet).
   */
  function enqueue(href: string, list: string, confirmedNow: Task | null, ics: string) {
    const previous: Promise<Task | null> = pending.current.get(href) ?? Promise.resolve(confirmedNow);
    const write = previous.then(async (confirmed) => {
      try {
        return await (confirmed ? client.saveTask(confirmed, ics) : client.createTask(href, ics));
      } catch (error) {
        throw new WriteFailure(confirmed, error);
      }
    });
    pending.current.set(href, write);

    write.then(
      (saved) => {
        if (pending.current.get(href) !== write) return; // a newer save is queued and settles the task
        pending.current.delete(href);
        if (saved.etag) replace(saved);
        else void load(list); // the server did not send the new ETag: reload to get it
      },
      (reason: unknown) => {
        if (pending.current.get(href) !== write) return; // the newest save fails with it and reports it
        pending.current.delete(href);
        const { confirmed, error } = reason as WriteFailure;
        const listNow = listOf(href) ?? list;
        if (confirmed) replace(confirmed);
        else remove(href);

        if (error instanceof CalDavError && error.status === 401) return callbacks.current.onLogout();
        const unreachable = error instanceof CalDavError && error.status === 0;
        // The server refused (conflict, gone, error): show what it has now. Retrying would overwrite that.
        if (!unreachable) void load(listNow);
        callbacks.current.onWriteError({
          message: error instanceof Error ? error.message : 'Could not save the task.',
          retry: unreachable ? () => (confirmed ? change(href, () => ics) : insert(listNow, href, ics)) : undefined,
        });
      },
    );
  }

  /**
   * Shows the task's new content at once and saves it in the background; returns the task as now shown.
   * `apply` returning null changes nothing.
   */
  function change(href: string, apply: (task: Task) => string | null): Task | null {
    const current = find(href);
    const list = listOf(href);
    if (!current || !list) return null;
    const ics = apply(current);
    if (ics === null) return null;
    const changed = parseTask(href, current.etag, ics);
    replace(changed);
    enqueue(href, list, current, ics);
    return changed;
  }

  function insert(list: string, href: string, ics: string) {
    setLists((current) => ({ ...current, [list]: [...(current[list] ?? NO_TASKS), parseTask(href, '', ics)] }));
    enqueue(href, list, null, ics);
  }

  /** Finds the list holding a task among `calendars`, keeping every list it loads for later. */
  const locate = useCallback(
    async (uid: string, calendars: Calendar[]): Promise<string | undefined> => {
      for (const calendar of calendars) {
        const fresh = await client.listTasks(calendar.href).catch(() => null); // unreadable: not where the task is
        if (!fresh) continue;
        setLists((current) => ({ ...current, [calendar.href]: withPending(current[calendar.href], fresh) }));
        setFetched((current) => new Set(current).add(calendar.href));
        if (fresh.some((t) => t.uid === uid)) return calendar.href;
      }
      return undefined;
    },
    [client, setLists, withPending],
  );

  return {
    tasks,
    groups,
    /** The list a task on screen is in. */
    listOf: (task: Task) => listByTask.get(task.href),
    /** The lists on screen are known, from the server or from memory. */
    loaded: shown.length > 0 && shown.every((href) => href in lists),
    /** The lists on screen came from the server at least once, so a task missing from them is really elsewhere. */
    fetched: shown.length > 0 && shown.every((href) => fetched.has(href)),
    loadError: shown.map((href) => loadErrors[href]).find((message) => message !== undefined) ?? null,
    reload: () => {
      for (const href of shown) void load(href);
    },
    /** Fetches a list again, on screen or not (after an import wrote to it directly). */
    refresh: (href: string) => void load(href),
    create: (list: string, edits: TaskEdits, parentUid?: string) => {
      const { uid, ics } = newTaskIcs(edits, { parentUid });
      insert(list, client.taskHref(list, uid), ics);
    },
    edit: (href: string, edits: TaskEdits) => change(href, (task) => applyEdits(task, edits)),
    setCompleted: (href: string, completed: boolean) => {
      change(href, (task) => withCompleted(task, completed));
    },
    /** Moves a repeating task to its next occurrence: the moved task, or null when the repeat is over. */
    advance: (href: string) => change(href, (task) => withNextOccurrence(task)),
    /** Puts back content the task had before (Undo), as a new revision. */
    restore: (href: string, ics: string) => {
      change(href, (task) => restoredTo(task, ics));
    },
    locate,
  };
}
