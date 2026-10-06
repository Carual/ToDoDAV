import type { Task } from '../api/tasks.ts';
import type { TaskTree } from './taskTree.ts';

// How the tasks of the lists on screen become rows: sorted, filtered and nested.

export type Compare = (a: Task, b: Task) => number;

/** Open tasks by due date (undated ones last, or first if asked), then by priority, then by name. */
export function taskOrder(undatedFirst: boolean): Compare {
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
export function compareCompleted(a: Task, b: Task): number {
  const byCompleted = (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0);
  return byCompleted || a.summary.localeCompare(b.summary);
}

export interface Row {
  task: Task;
  depth: number;
}

/** How the open tasks are listed, from the settings. */
export interface ListView {
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
export function openRows(tasks: Task[], tree: TaskTree, collapsed: ReadonlySet<string>, view: ListView): Row[] {
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

export const openChildren = (tree: TaskTree, task: Task, compare: Compare) =>
  tree.childrenOf(task).filter((t) => !t.completed).sort(compare);

/** Whether any open task below this one would show, so its chevron has something to hide. */
export function hasShownChildren(tree: TaskTree, task: Task, view: ListView): boolean {
  if (!view.nested) return false;
  return openChildren(tree, task, view.compare).some((child) => view.matches(child) || hasShownChildren(tree, child, view));
}

/** Direct sub-tasks: open ones first in list order, then completed ones. */
export const sortedChildren = (tree: TaskTree, task: Task, compare: Compare) => [
  ...openChildren(tree, task, compare),
  ...tree.childrenOf(task).filter((t) => t.completed).sort(compareCompleted),
];

export function subtaskCount(tree: TaskTree, task: Task) {
  const children = tree.childrenOf(task);
  return { done: children.filter((t) => t.completed).length, total: children.length };
}

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
