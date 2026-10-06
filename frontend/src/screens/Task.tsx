import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';

import { TaskModal } from '../components/tasks/TaskModal.tsx';
import { sortedChildren } from '../lib/taskRows.ts';
import { descendants } from '../lib/taskTree.ts';
import type { TasksParams } from '../navigation.tsx';
import { useFindElsewhere } from '../state/calendarChoice.ts';
import { useTasks } from '../state/tasksContext.tsx';

/** /tasks/<uid>: the task's modal over the list. */
export function Task({ navigation, route }: NativeStackScreenProps<TasksParams, 'Task'>) {
  const { uid } = route.params;
  const focused = useIsFocused();
  const tasks = useTasks();
  const { list, tree, view, calendarOf } = tasks;
  const task = list.tasks.find((t) => t.uid === uid);
  const calendar = task && calendarOf(task);

  // Back to the list under it: popTo lands on the list whatever is under this screen.
  const close = () => navigation.popTo('TaskList');

  // Completed tasks are only read when needed: the modal lists completed sub-tasks and deletes them with the task,
  // and a link may be to a completed task, so read them before looking elsewhere.
  const { includeCompleted } = list;
  const listHref = task && list.listOf(task);
  const shownKey = tasks.shownHrefs.join('\n');
  useEffect(() => {
    if (listHref) includeCompleted([listHref]);
    else if (list.fetched && shownKey) includeCompleted(shownKey.split('\n'));
  }, [listHref, list.fetched, shownKey, includeCompleted]);

  useFindElsewhere(uid, task === undefined && list.complete, tasks, list.locate, () => {
    tasks.showToast({ message: 'Task not found' });
    close();
  });

  // A task opened from this one goes over it; this one steps aside meanwhile (one backdrop, not two) and comes back
  // fresh, without edits the user chose to discard on the way.
  if (!task || !calendar || !focused) return null;
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
      // Pushed, so Back returns to this task; closing still pops them all (popTo).
      onOpenTask={(other) => navigation.push('Task', { uid: other.uid })}
      onAddSubtask={(summary) => tasks.addSubtask(task, summary)}
      showMap={tasks.settings.showMap}
    />
  );
}
