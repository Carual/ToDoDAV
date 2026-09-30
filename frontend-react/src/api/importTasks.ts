import type { CalDavClient } from './caldav.ts';
import type { ImportItem } from './icsFile.ts';

/** Tasks going into one list. */
export interface ImportTarget {
  href: string;
  items: ImportItem[];
  /** A list just created: known to be empty, so it isn't read first. */
  isNew?: boolean;
}

export interface ImportResult {
  imported: number;
  /** Tasks already in their list (same UID). */
  skipped: number;
  failures: string[];
  /** Lists that got at least one task, so they have to be fetched again. */
  changed: string[];
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

/** Runs `run` on every item, at most `limit` at a time, so a big import doesn't flood the server. */
async function eachLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Stores each task in its list with If-None-Match: *. A task already in the list (same UID) is left alone, so
 * importing the same tasks twice adds nothing and an interrupted import can simply be run again. Reading a
 * list fails the whole import; a task that can't be stored is reported and the others go on.
 */
export async function storeTasks(
  client: CalDavClient,
  targets: ImportTarget[],
  onProgress: (done: number, total: number) => void,
): Promise<ImportResult> {
  const todo: { href: string; item: ImportItem }[] = [];
  let skipped = 0;
  for (const { href, items, isNew } of targets) {
    const existing = isNew ? new Set<string>() : new Set((await client.listTasks(href)).map((t) => t.uid));
    for (const item of items) {
      if (existing.has(item.uid)) skipped++;
      else todo.push({ href, item });
    }
  }

  const failures: string[] = [];
  const changed = new Set<string>();
  let done = 0;
  onProgress(done, todo.length);
  await eachLimited(todo, 4, async ({ href, item }) => {
    try {
      await client.createTask(client.taskHref(href, item.uid), item.ics);
      changed.add(href);
    } catch (error) {
      failures.push(`${item.summary || 'Untitled task'}: ${messageOf(error)}`);
    }
    onProgress(++done, todo.length);
  });
  return { imported: todo.length - failures.length, skipped, failures, changed: [...changed] };
}
