import { useState } from 'react';
import type { Task } from '../api/tasks.ts';
import { describeDue } from '../format.ts';
import { CalendarIcon, CheckIcon, PencilIcon, TagIcon } from './icons.tsx';

interface Props {
  task: Task;
  onOpen: (task: Task) => void;
  onComplete: (task: Task) => void;
}

/** Delay between ticking the circle and the task leaving the list, like Todoist. */
const COMPLETE_ANIMATION_MS = 300;

export function TaskCheckbox({ task, onComplete }: { task: Task; onComplete: (task: Task) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <button
      type="button"
      className={`task-check p${task.priority}${checked ? ' checked' : ''}`}
      aria-label="Complete task"
      onClick={(event) => {
        event.stopPropagation();
        if (checked) return;
        setChecked(true);
        setTimeout(() => onComplete(task), COMPLETE_ANIMATION_MS);
      }}
    >
      <CheckIcon />
    </button>
  );
}

export function TaskItem({ task, onOpen, onComplete }: Props) {
  const due = task.due && describeDue(task.due);
  const firstLine = task.description.split('\n')[0];

  return (
    <li className="task" onClick={() => onOpen(task)}>
      <TaskCheckbox task={task} onComplete={onComplete} />
      <div className="task-body">
        <div className="task-title">{task.summary || <span className="muted">Untitled task</span>}</div>
        {firstLine && <div className="task-desc">{firstLine}</div>}
        {(due || task.categories.length > 0) && (
          <div className="task-meta">
            {due && (
              <span className={`due due-${due.tone}`}>
                <CalendarIcon />
                {due.label}
              </span>
            )}
            {task.categories.map((label) => (
              <span key={label} className="label">
                <TagIcon />
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="task-actions">
        <button
          type="button"
          className="icon-btn"
          aria-label="Edit task"
          title="Edit task"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(task);
          }}
        >
          <PencilIcon />
        </button>
      </div>
    </li>
  );
}
