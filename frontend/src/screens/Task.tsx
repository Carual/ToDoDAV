import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { TaskModal } from '../components/tasks/TaskModal.tsx';
import { sortedChildren } from '../lib/taskRows.ts';
import { descendants } from '../lib/taskTree.ts';
import type { TasksParams } from '../navigation.tsx';
import { useFindElsewhere } from '../state/calendarChoice.ts';
import { useTasks } from '../state/tasksContext.tsx';

/** /tasks/<uid>: the task's modal over the list. */
export function Task({ navigation, route }: NativeStackScreenProps<TasksParams, 'Task'>) {
  const { uid } = route.params;
  const tasks = useTasks();
  const { list, tree, view, calendarOf } = tasks;
  const task = list.tasks.find((t) => t.uid === uid);
  const calendar = task && calendarOf(task);

  // Back to the list under it: popTo lands on the list whatever is under this screen.
  const close = () => navigation.popTo('TaskList');

  useFindElsewhere(uid, task === undefined && list.fetched, tasks, list.locate, () => {
    tasks.showToast({ message: 'Task not found' });
    close();
  });

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
