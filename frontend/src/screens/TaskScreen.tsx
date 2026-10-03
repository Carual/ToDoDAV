import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';

import { TaskModal } from '../components/tasks/TaskModal.tsx';
import { sortedChildren } from '../lib/taskRows.ts';
import { descendants } from '../lib/taskTree.ts';
import type { TasksParams } from '../navigation.tsx';
import { useTasks } from '../state/tasksContext.tsx';

/** /tasks/<uid>: the task's modal over the list. */
export function TaskScreen({ navigation, route }: NativeStackScreenProps<TasksParams, 'Task'>) {
  const { uid } = route.params;
  const tasks = useTasks();
  const { list, tree, view, calendars, calendarOf, allView, selectCalendar, showToast } = tasks;
  const task = list.tasks.find((t) => t.uid === uid);
  const calendar = task && calendarOf(task);

  // Back to the list under it: popTo lands on the list whatever is under this screen.
  const close = () => navigation.popTo('TaskList');

  // A task link can point to another list (the URL has only the UID): look there and switch to it.
  const missing = task === undefined && list.fetched;
  const { locate } = list;
  useEffect(() => {
    if (!missing || !uid) return;
    let cancelled = false;
    const others = allView ? [] : calendars.filter((c) => c.href !== tasks.selected);
    void locate(uid, others).then((found) => {
      if (cancelled) return;
      if (found) return selectCalendar(found);
      showToast({ message: 'Task not found' });
      navigation.popTo('TaskList');
    });
    return () => {
      cancelled = true;
    };
  }, [missing, uid]);

  if (!task || !calendar) return null;
  return (
    <TaskModal
      // Remount only when the content changes (a reload or a failed save), not when a save just confirms it.
      key={`${task.href} ${task.ics}`}
      guard="navigation"
      task={task}
      parent={tree.parentOf(task)}
      subtasks={sortedChildren(tree, task, view.compare)}
      calendar={calendar}
      onClose={close}
      onSave={(edits) => tasks.saveEdits(task, edits)}
      onToggle={tasks.toggleTask}
      onCompleteForGood={(t) => tasks.setCompleted(t, true, true)}
      onDelete={tasks.deleteTask}
      descendantCount={descendants(tree, task).length}
      onOpenTask={(other) => navigation.replace('Task', { uid: other.uid })}
      onAddSubtask={(summary) => tasks.addSubtask(task, summary)}
    />
  );
}
