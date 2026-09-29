import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Task } from '../api/tasks.ts';
import { describeDue, describeRepeat } from '../format.ts';
import { BLOCK_FIELDS, type RowField } from '../viewSettings.ts';
import { CalendarIcon, CheckIcon, ChevronDownIcon, MapPinIcon, PencilIcon, RepeatIcon, SubtaskIcon, TagIcon } from './icons.tsx';

interface Props {
  task: Task;
  /** How far the task sits below other tasks (0: top level). */
  depth?: number;
  /** Direct sub-tasks: how many are done, out of how many. */
  subtasks?: { done: number; total: number };
  /** The details to show under the title, in order (from the settings). */
  fields: RowField[];
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
  // A repeating task comes back open on its next date (and a failed save flips a task back): drop the tick.
  useEffect(() => setChecked(task.completed), [task.completed, task.ics]);
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

/** The repeat icon after a date, with the rule in words on hover. */
export function RepeatMark({ task }: { task: Task }) {
  if (!task.recurrence) return null;
  const words = describeRepeat(task.recurrence, task.start ?? task.due);
  return (
    <span className="repeat-mark" title={words} aria-label={words}>
      <RepeatIcon />
    </span>
  );
}

/** One detail of a row, or nothing when the task has no such detail. */
function renderField(field: RowField, task: Task, subtasks: Props['subtasks']): ReactNode {
  switch (field) {
    case 'description': {
      const firstLine = task.description.split('\n')[0];
      return firstLine && <div className="task-desc">{firstLine}</div>;
    }
    case 'location':
      return (
        task.location && (
          <div className="task-location">
            <MapPinIcon />
            <span>{task.location}</span>
          </div>
        )
      );
    case 'subtasks':
      return (
        subtasks !== undefined &&
        subtasks.total > 0 && (
          <span className="label" title="Sub-tasks done">
            <SubtaskIcon />
            {subtasks.done}/{subtasks.total}
          </span>
        )
      );
    case 'start':
      return (
        task.start && (
          <span className="label" title="Start date">
            <CalendarIcon />
            Starts {describeDue(task.start).label}
            {/* A repeat usually sits on the due date; with none, the start date carries it. */}
            {!task.due && <RepeatMark task={task} />}
          </span>
        )
      );
    case 'due': {
      const due = task.due && describeDue(task.due);
      return (
        due && (
          <span className={`due due-${due.tone}`} title="Due date">
            <CalendarIcon />
            {due.label}
            <RepeatMark task={task} />
          </span>
        )
      );
    }
    case 'labels':
      return task.categories.map((label) => (
        <span key={label} className="label">
          <TagIcon />
          {label}
        </span>
      ));
  }
}

/** The details in the chosen order; small ones next to each other share a line. */
function TaskDetails({ task, fields, subtasks }: { task: Task; fields: RowField[]; subtasks: Props['subtasks'] }) {
  const lines: ReactNode[] = [];
  let inline: ReactNode[] = [];
  const flush = () => {
    if (inline.length > 0) lines.push(<div key={lines.length} className="task-meta">{inline}</div>);
    inline = [];
  };
  for (const field of fields) {
    const content = renderField(field, task, subtasks);
    const empty = !content || (Array.isArray(content) && content.length === 0);
    if (empty) continue;
    if (BLOCK_FIELDS.has(field)) {
      flush();
      lines.push(<Fragment key={lines.length}>{content}</Fragment>);
    } else {
      inline.push(<Fragment key={field}>{content}</Fragment>);
    }
  }
  flush();
  return <>{lines}</>;
}

export function TaskItem({ task, depth = 0, subtasks, fields, collapsed, onToggleCollapsed, onOpen, onToggle }: Props) {
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
        <TaskDetails task={task} fields={fields} subtasks={subtasks} />
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
