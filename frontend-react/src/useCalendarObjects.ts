import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalDavError, type CalDavClient, type Calendar } from './api/caldav.ts';

export interface WriteError {
  message: string;
  /** Present when the server was not reached, so trying again can still work. */
  retry?: () => void;
}

/** What every calendar object kept in a list has: where it is stored, its ETag, its text and UID. */
export interface CalendarObject {
  href: string;
  etag: string;
  ics: string;
  uid: string;
}

/** How to read one kind of calendar object (tasks, journal entries). Keep it a module constant: it is a dependency. */
export interface ObjectKind<T extends CalendarObject> {
  list: (client: CalDavClient, calendarHref: string) => Promise<T[]>;
  parse: (href: string, etag: string, ics: string) => T;
  /** "task", "entry": for messages. */
  noun: string;
}

/** A save that failed, with the object as the server last confirmed it (null: it was never created). */
class WriteFailure<T> {
  readonly confirmed: T | null;
  readonly error: unknown;

  constructor(confirmed: T | null, error: unknown) {
    this.confirmed = confirmed;
    this.error = error;
  }
}

/** Objects per calendar href. */
type Lists<T> = Record<string, T[]>;

const NONE: never[] = [];

function mapLists<T>(lists: Lists<T>, update: (items: T[]) => T[]): Lists<T> {
  return Object.fromEntries(Object.entries(lists).map(([href, items]) => [href, update(items)]));
}

export interface ListOptions {
  client: CalDavClient;
  /** The calendars on screen: one, or every one in the "All" view. */
  calendarHrefs: string[];
  onLogout: () => void;
  onWriteError: (error: WriteError) => void;
}

/**
 * The objects of every calendar seen so far, changed optimistically: a change shows at once and is saved in the
 * background. If the save fails, the object goes back to what the server has. Calendars seen before are shown
 * from memory while a fresh copy loads, so switching lists is instant too.
 */
export function useCalendarObjects<T extends CalendarObject>(
  kind: ObjectKind<T>,
  { client, calendarHrefs, onLogout, onWriteError }: ListOptions,
) {
  const [lists, setListsState] = useState<Lists<T>>({});
  // The same lists, readable right after a change (before React re-renders) and from old closures like Undo.
  const listsRef = useRef<Lists<T>>({});
  /** Lists fetched from the server at least once, not only built up locally. */
  const [fetched, setFetched] = useState<ReadonlySet<string>>(() => new Set());
  /** Why the last load of a list failed, per list href. */
  const [loadErrors, setLoadErrors] = useState<Readonly<Record<string, string>>>({});
  const loadIds = useRef(new Map<string, number>());
  /**
   * Saves still on their way, per object href; each resolves to the object as the server then has it (null once
   * deleted). Saves to one object go one at a time, each with the ETag the previous one got back, so quick
   * successive changes (edit, complete, Undo, delete) never trip If-Match on each other.
   */
  const pending = useRef(new Map<string, Promise<T | null>>());
  const callbacks = useRef({ onLogout, onWriteError });
  useEffect(() => {
    callbacks.current = { onLogout, onWriteError };
  });

  const setLists = useCallback((update: (lists: Lists<T>) => Lists<T>) => {
    listsRef.current = update(listsRef.current);
    setListsState(listsRef.current);
  }, []);

  /**
   * Fresh objects from the server, keeping the local version of those with a save still in flight. One with
   * a save in flight that is gone locally is being deleted, so it stays gone.
   */
  const withPending = useCallback((local: T[] | undefined, fresh: T[]): T[] => {
    const inFlight = (local ?? NONE).filter((t) => pending.current.has(t.href));
    const freshHrefs = new Set(fresh.map((t) => t.href));
    return [
      ...fresh.flatMap((t) => (pending.current.has(t.href) ? inFlight.filter((l) => l.href === t.href) : [t])),
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
        const fresh = await kind.list(client, href);
        if (loadIds.current.get(href) !== id) return; // a newer load of this list wins
        setLists((current) => ({ ...current, [href]: withPending(current[href], fresh) }));
        setFetched((current) => new Set(current).add(href));
      } catch (err) {
        if (err instanceof CalDavError && err.status === 401) return callbacks.current.onLogout();
        if (loadIds.current.get(href) !== id) return;
        const message = err instanceof Error ? err.message : `Could not load the ${kind.noun}s.`;
        setLoadErrors((current) => ({ ...current, [href]: message }));
      }
    },
    [kind, client, setLists, withPending],
  );

  // Hrefs never hold a newline, so the joined key only changes when the lists on screen do.
  const shownKey = calendarHrefs.join('\n');
  const shown = useMemo(() => (shownKey ? shownKey.split('\n') : []), [shownKey]);

  useEffect(() => {
    for (const href of shown) void load(href);
  }, [shown, load]);

  /** The objects on screen, one group per list, so sub-tasks only nest within their own list. */
  const groups = useMemo(() => shown.map((href) => lists[href] ?? (NONE as T[])), [shown, lists]);
  const items = useMemo(() => groups.flat(), [groups]);
  /** Which list each object on screen is in, by object href. */
  const listByItem = useMemo(
    () => new Map(shown.flatMap((list) => (lists[list] ?? NONE).map((t: T) => [t.href, list] as const))),
    [shown, lists],
  );

  const find = (href: string) => Object.values(listsRef.current).flat().find((t) => t.href === href);
  const listOf = (href: string) =>
    Object.keys(listsRef.current).find((list) => listsRef.current[list]!.some((t) => t.href === href));

  const replace = (item: T) =>
    setLists((current) => mapLists(current, (items) => items.map((t) => (t.href === item.href ? item : t))));
  const remove = (href: string) => setLists((current) => mapLists(current, (items) => items.filter((t) => t.href !== href)));
  /** Replaces the object in `list`, or adds it back there if it was removed (a delete that failed). */
  const putBack = (list: string, item: T) =>
    setLists((current) => {
      const items = current[list] ?? NONE;
      const present = items.some((t) => t.href === item.href);
      return { ...current, [list]: present ? items.map((t) => (t.href === item.href ? item : t)) : [...items, item] };
    });

  /**
   * Saves `ics` as the object's content (null deletes it) once the saves before it are done. `confirmedNow` is
   * the object as the server has it when nothing is queued (null for one not created yet).
   */
  function enqueue(href: string, list: string, confirmedNow: T | null, ics: string | null) {
    const previous: Promise<T | null> = pending.current.get(href) ?? Promise.resolve(confirmedNow);
    const write = previous.then(async (confirmed) => {
      try {
        if (ics === null) {
          if (confirmed) await client.deleteObject(confirmed);
          return null;
        }
        const etag = await (confirmed ? client.saveObject(confirmed, ics) : client.createObject(href, ics));
        return kind.parse(href, etag, ics);
      } catch (error) {
        throw new WriteFailure(confirmed, error);
      }
    });
    pending.current.set(href, write);

    write.then(
      (saved) => {
        if (pending.current.get(href) !== write) return; // a newer save is queued and settles the object
        pending.current.delete(href);
        if (!saved) return; // deleted, and already gone from the list
        if (saved.etag) replace(saved);
        else void load(list); // the server did not send the new ETag: reload to get it
      },
      (reason: unknown) => {
        if (pending.current.get(href) !== write) return; // the newest save fails with it and reports it
        pending.current.delete(href);
        const { confirmed, error } = reason as WriteFailure<T>;
        const listNow = listOf(href) ?? list;
        if (confirmed) putBack(listNow, confirmed);
        else remove(href);
        // Deleted before it was ever stored: nothing is left to report.
        if (ics === null && !confirmed) return;

        if (error instanceof CalDavError && error.status === 401) return callbacks.current.onLogout();
        const unreachable = error instanceof CalDavError && error.status === 0;
        // The server refused (conflict, gone, error): show what it has now. Retrying would overwrite that.
        if (!unreachable) void load(listNow);
        const retry =
          ics === null ? () => destroy(href) : confirmed ? () => change(href, () => ics) : () => insert(listNow, href, ics);
        callbacks.current.onWriteError({
          message: error instanceof Error ? error.message : `Could not save the ${kind.noun}.`,
          retry: unreachable ? retry : undefined,
        });
      },
    );
  }

  /**
   * Shows the object's new content at once and saves it in the background; returns the object as now shown.
   * `apply` returning null changes nothing.
   */
  function change(href: string, apply: (item: T) => string | null): T | null {
    const current = find(href);
    const list = listOf(href);
    if (!current || !list) return null;
    const ics = apply(current);
    if (ics === null) return null;
    const changed = kind.parse(href, current.etag, ics);
    replace(changed);
    enqueue(href, list, current, ics);
    return changed;
  }

  /** Shows a new object at once and stores it in the background (never over an existing one). */
  function insert(list: string, href: string, ics: string) {
    setLists((current) => ({ ...current, [list]: [...(current[list] ?? NONE), kind.parse(href, '', ics)] }));
    enqueue(href, list, null, ics);
  }

  /** Removes the object at once and deletes it in the background. */
  function destroy(href: string) {
    const current = find(href);
    const list = listOf(href);
    if (!current || !list) return;
    remove(href);
    enqueue(href, list, current, null);
  }

  /** Finds the list holding an object among `calendars`, keeping every list it loads for later. */
  const locate = useCallback(
    async (uid: string, calendars: Calendar[]): Promise<string | undefined> => {
      for (const calendar of calendars) {
        const fresh = await kind.list(client, calendar.href).catch(() => null); // unreadable: not where it is
        if (!fresh) continue;
        setLists((current) => ({ ...current, [calendar.href]: withPending(current[calendar.href], fresh) }));
        setFetched((current) => new Set(current).add(calendar.href));
        if (fresh.some((t) => t.uid === uid)) return calendar.href;
      }
      return undefined;
    },
    [kind, client, setLists, withPending],
  );

  return {
    items,
    groups,
    /** The list an object on screen is in. */
    listOf: (item: T) => listByItem.get(item.href),
    /** The lists on screen are known, from the server or from memory. */
    loaded: shown.length > 0 && shown.every((href) => href in lists),
    /** The lists on screen came from the server at least once, so an object missing from them is really elsewhere. */
    fetched: shown.length > 0 && shown.every((href) => fetched.has(href)),
    loadError: shown.map((href) => loadErrors[href]).find((message) => message !== undefined) ?? null,
    reload: () => {
      for (const href of shown) void load(href);
    },
    /** Fetches a list again, on screen or not (after an import wrote to it directly). */
    refresh: (href: string) => void load(href),
    change,
    insert,
    destroy,
    locate,
  };
}
