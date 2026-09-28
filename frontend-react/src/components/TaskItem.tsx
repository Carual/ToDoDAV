import { useState, type CSSProperties } from 'react';
import type { Task } from '../api/tasks.ts';
import { describeDue } from '../format.ts';
import { CalendarIcon, CheckIcon, ChevronDownIcon, PencilIcon, SubtaskIcon, TagIcon } from './icons.tsx';

interface Props {
  task: Task;
  /** How far the task sits below other tasks (0: top level). */
  depth?: number;
  /** Direct sub-tasks: how many are done, out of how many. */
  subtasks?: { done: number; total: number };
  /** Whether the open sub-tasks under this row are hidden; only for rows that have some. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onOpen: (task: Task) => void;
  /** Completes an open task or reopens a completed one. */
  onToggle: (task: Task) => void;
}

/** Deeper sub-tasks stop moving right, so the list stays readable on narrow screens. */
const MAX_INDENT = 5;

/** Delay between ticking the circle and the task leaving the list, like Todoist. */
const COMPLETE_ANIMATION_MS = 300;

export function TaskCheckbox({ task, onToggle }: { task: Task; onToggle: (task: Task) => void }) {
  const [checked, setChecked] = useState(task.completed);
  return (
    <button
      type="button"
      className={`task-check p${task.priority}${checked ? ' checked' : ''}`}
      aria-label={task.completed ? 'Reopen task' : 'Complete task'}
      onClick={(event) => {
        event.stopPropagation();
        if (checked !== task.completed) return; // already on its way out
        setChecked(!checked);
        setTimeout(() => onToggle(task), COMPLETE_ANIMATION_MS);
      }}
    >
      <CheckIcon />
    </button>
  );
}

export function TaskItem({ task, depth = 0, subtasks, collapsed, onToggleCollapsed, onOpen, onToggle }: Props) {
  const due = task.due && describeDue(task.due);
  const firstLine = task.description.split('\n')[0];
  const hasSubtasks = subtasks !== undefined && subtasks.total > 0;

  return (
    <li
      className={`task${task.completed ? ' task-done' : ''}`}
      style={{ '--depth': Math.min(depth, MAX_INDENT) } as CSSProperties}
      onClick={() => onOpen(task)}
    >
      {onToggleCollapsed && (
        <button
          type="button"
          className="task-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Show sub-tasks' : 'Hide sub-tasks'}
          title={collapsed ? 'Show sub-tasks' : 'Hide sub-tasks'}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapsed();
          }}
        >
          <ChevronDownIcon />
        </button>
      )}
      <TaskCheckbox task={task} onToggle={onToggle} />
      <div className="task-body">
        <div className="task-title">{task.summary || <span className="muted">Untitled task</span>}</div>
        {firstLine && <div className="task-desc">{firstLine}</div>}
        {(due || hasSubtasks || task.categories.length > 0) && (
          <div className="task-meta">
            {hasSubtasks && (
              <span className="label" title="Sub-tasks done">
                <SubtaskIcon />
                {subtasks.done}/{subtasks.total}
              </span>
            )}
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
