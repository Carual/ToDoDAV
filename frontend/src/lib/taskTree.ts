import type { Task } from '../api/tasks.ts';

/** How the tasks of one list nest, following each task's RELATED-TO parent. */
export interface TaskTree {
  /** The parent the task sits under, when that parent is in the same list. */
  parentOf: (task: Task) => Task | undefined;
  /** Direct sub-tasks, open and completed, in no particular order. */
  childrenOf: (task: Task) => Task[];
}

export function buildTree(tasks: Task[]): TaskTree {
  const byUid = new Map(tasks.map((t) => [t.uid, t]));
  const declared = (task: Task) => (task.parentUid === undefined ? undefined : byUid.get(task.parentUid));
  // Other clients can write loops (A under B under A). A task whose parents lead back to itself stays at the
  // top level, so every task still shows up exactly once.
  const loops = (task: Task) => {
    const seen = new Set<Task>();
    for (let t = declared(task); t && !seen.has(t); t = declared(t)) {
      if (t === task) return true;
      seen.add(t);
    }
    return false;
  };

  const parents = new Map<Task, Task>();
  const children = new Map<Task, Task[]>();
  for (const task of tasks) {
    const parent = declared(task);
    if (!parent || loops(task)) continue;
    parents.set(task, parent);
    children.set(parent, [...(children.get(parent) ?? []), task]);
  }
  return {
    parentOf: (task) => parents.get(task),
    childrenOf: (task) => children.get(task) ?? [],
  };
}

/** One tree over several lists, each built on its own: a task never nests under a parent in another list. */
export function joinTrees(trees: TaskTree[]): TaskTree {
  if (trees.length === 1) return trees[0]!;
  return {
    parentOf: (task) => trees.map((tree) => tree.parentOf(task)).find((parent) => parent !== undefined),
    childrenOf: (task) => trees.flatMap((tree) => tree.childrenOf(task)),
  };
}

/** Every task below this one, at any depth. */
export function descendants(tree: TaskTree, task: Task): Task[] {
  return tree.childrenOf(task).flatMap((child) => [child, ...descendants(tree, child)]);
}

/** The task's parent, its parent's parent, and so on. */
export function ancestors(tree: TaskTree, task: Task): Task[] {
  const parent = tree.parentOf(task);
  return parent ? [parent, ...ancestors(tree, parent)] : [];
}
