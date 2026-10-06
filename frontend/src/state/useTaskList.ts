import {
  applyEdits,
  newTaskIcs,
  parseTask,
  restoredTo,
  withCompleted,
  withNextOccurrence,
  type Task,
  type TaskEdits,
} from '../api/tasks.ts';
import { useCalendarObjects, type ListOptions, type ObjectKind } from './useCalendarObjects.ts';

export type { WriteError } from './useCalendarObjects.ts';

const TASKS: ObjectKind<Task> = {
  list: (client, href) => client.listTasks(href),
  listOpen: (client, href) => client.listTasks(href, { openOnly: true }),
  isOpen: (task) => !task.completed,
  parse: parseTask,
  noun: 'task',
};

/** The tasks of every list seen so far, changed optimistically (see useCalendarObjects). */
export function useTaskList(options: ListOptions) {
  const list = useCalendarObjects(TASKS, options);
  const { client } = options;
  const { change, insert } = list;

  return {
    tasks: list.items,
    groups: list.groups,
    /** The list a task on screen is in. */
    listOf: list.listOf,
    loaded: list.loaded,
    fetched: list.fetched,
    loadError: list.loadError,
    reload: list.reload,
    refresh: list.refresh,
    /** The lists on screen hold their completed tasks too (they are only read once asked for). */
    complete: list.complete,
    includeCompleted: list.includeCompleted,
    create: (calendarHref: string, edits: TaskEdits, parentUid?: string) => {
      const { uid, ics } = newTaskIcs(edits, { parentUid });
      insert(calendarHref, client.objectHref(calendarHref, uid), ics);
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
    /** Deletes a task for good (sub-tasks are the caller's to delete too). */
    delete: list.destroy,
    /** Stores a deleted task again, exactly as it was (Undo), under its old href. */
    undelete: (calendarHref: string, task: Task) => insert(calendarHref, task.href, task.ics),
    locate: list.locate,
  };
}
