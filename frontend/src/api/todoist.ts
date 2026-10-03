import ICAL from 'ical.js';
import { buildTree } from '../taskTree.ts';
import { parseCsv, toCsv } from './csv.ts';
import type { ImportItem, ParsedImport } from './icsFile.ts';
import { newTaskIcs, type LocalDate, type Priority, type Task, type TaskEdits } from './tasks.ts';
import { addMinutes, formatTodoistDate, parseTodoistDate, type TodoistDate } from './todoistDates.ts';

// Todoist's CSV format: https://www.todoist.com/help/articles/import-or-export-a-project-as-a-csv-file-in-todoist-YC8YvN
const COLUMNS = [
  'TYPE',
  'CONTENT',
  'DESCRIPTION',
  'PRIORITY',
  'INDENT',
  'AUTHOR',
  'RESPONSIBLE',
  'DATE',
  'DATE_LANG',
  'TIMEZONE',
  'DURATION',
  'DURATION_UNIT',
  'DEADLINE',
  'DEADLINE_LANG',
] as const;
type Column = (typeof COLUMNS)[number];

/** Todoist refuses a CSV with more task rows than this. */
export const TODOIST_TASK_LIMIT = 300;
/** A task and three levels of sub-tasks: the deepest INDENT Todoist's help describes. */
const MAX_INDENT = 4;
/** Todoist has no location, so it travels as a comment starting with this, and comes back from one. */
const LOCATION_NOTE = 'Location: ';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const row = (cells: Partial<Record<Column, string>>) => COLUMNS.map((column) => cells[column] ?? '');

/** Todoist labels are single words in the task name. */
const labelTag = (label: string) => `@${label.trim().replace(/\s+/g, '_')}`;

const minutesOf = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * When the task is scheduled, as Todoist sees it. Todoist has no start date, but it has a duration that
 * starts at the date: a timed start earlier on the due day becomes that start plus a duration.
 */
function scheduleOf({ start, due }: Task): { when: LocalDate; duration?: number } | undefined {
  if (!due) return undefined;
  if (start?.time && due.time && start.date === due.date && start.time < due.time) {
    return { when: start, duration: minutesOf(due.time) - minutesOf(start.time) };
  }
  return { when: due };
}

export interface TodoistExport {
  csv: string;
  /** Tasks in the file. */
  count: number;
  warnings: string[];
}

/**
 * The open tasks of a list as a Todoist CSV, in list order with sub-tasks indented under their parent.
 * Completed tasks are left out, as in Todoist's own export: Todoist cannot import them.
 */
export function tasksToTodoist(tasks: Task[], compare: (a: Task, b: Task) => number): TodoistExport {
  const tree = buildTree(tasks);
  const rows = [[...COLUMNS], row({ TYPE: 'meta', CONTENT: 'view_style=list' }), row({})];
  let count = 0;
  let repeatsLost = 0;
  let flattened = 0;

  const visit = (task: Task, depth: number) => {
    count++;
    if (depth >= MAX_INDENT) flattened++;
    const schedule = scheduleOf(task);
    const date = schedule && formatTodoistDate(schedule.when, task.recurrence ? ICAL.Recur.fromString(task.recurrence) : undefined);
    if (date?.repeatLost) repeatsLost++;
    const name = task.summary.replace(/\s+/g, ' ').trim() || 'Untitled task';
    rows.push(
      row({
        TYPE: 'task',
        CONTENT: [name, ...task.categories.map(labelTag)].join(' '),
        DESCRIPTION: task.description,
        // Always written: Todoist reads an empty PRIORITY as p1, not as "no priority".
        PRIORITY: String(task.priority),
        INDENT: String(Math.min(depth + 1, MAX_INDENT)),
        DATE: date?.text,
        DATE_LANG: date && 'en',
        DURATION: schedule?.duration ? String(schedule.duration) : undefined,
        DURATION_UNIT: schedule?.duration ? 'minute' : undefined,
      }),
    );
    if (task.location) rows.push(row({ TYPE: 'note', CONTENT: LOCATION_NOTE + task.location }));
    if (task.url) rows.push(row({ TYPE: 'note', CONTENT: task.url }));
    for (const child of tree.childrenOf(task).filter((t) => !t.completed).sort(compare)) visit(child, depth + 1);
  };
  // As in the list: an open sub-task of a completed parent stands on its own.
  const isRoot = (task: Task) => !tree.parentOf(task) || tree.parentOf(task)!.completed;
  for (const task of tasks.filter((t) => !t.completed && isRoot(t)).sort(compare)) visit(task, 0);

  const warnings: string[] = [];
  if (count > TODOIST_TASK_LIMIT) {
    warnings.push(`Todoist imports at most ${TODOIST_TASK_LIMIT} tasks per project, and this file has ${count}.`);
  }
  if (repeatsLost > 0) {
    warnings.push(`${plural(repeatsLost, 'repeating task')} can't be described in Todoist's words, so only the next date was exported.`);
  }
  if (flattened > 0) {
    warnings.push(`Todoist nests tasks ${MAX_INDENT} levels deep; ${plural(flattened, 'deeper sub-task')} went to the last level.`);
  }
  return { csv: toCsv(rows), count, warnings };
}

interface Draft {
  edits: TaskEdits;
  /** Index of the parent draft. */
  parent?: number;
  /** Added to the description: comments, and anything the task has no field for. */
  extra: string[];
}

const PRIORITIES: readonly Priority[] = [1, 2, 3, 4];

/**
 * Puts Todoist's date, duration (in minutes) and deadline (yyyy-mm-dd) on a task. A task here has a start and one
 * due date: a duration becomes a start and a due time, both timed as iCalendar requires, and the deadline takes
 * the due date only when Todoist had no date. Returns the deadline when it has to go in the description instead.
 */
export function setSchedule(edits: TaskEdits, date: TodoistDate | undefined, minutes: number, deadline?: string) {
  if (date) {
    edits.recurrence = date.recurrence;
    if (date.due.time && minutes > 0) {
      edits.start = date.due;
      edits.due = addMinutes(date.due, minutes);
    } else edits.due = date.due;
  }
  if (!deadline) return undefined;
  if (edits.due) return deadline;
  edits.due = { date: deadline };
  return undefined;
}

/** A Todoist comment on a task: `Location: ...` (as the CSV export writes it) sets the location, others join `extra`. */
export function addComment(edits: TaskEdits, extra: string[], content: string) {
  if (content.startsWith(LOCATION_NOTE) && !edits.location) edits.location = content.slice(LOCATION_NOTE.length).trim();
  else extra.push(content);
}

/**
 * The tasks of a Todoist CSV (an export or Todoist's template). Columns are found by their header, since
 * older exports have fewer of them. Sub-tasks follow INDENT, comments (notes) join their task's description,
 * and a section becomes a label on the tasks under it.
 */
export function todoistToTasks(text: string, now = new Date()): ParsedImport {
  const [header = [], ...rows] = parseCsv(text);
  const columns = new Map(header.map((name, index) => [name.trim().toUpperCase(), index]));
  if (!columns.has('TYPE') || !columns.has('CONTENT')) {
    throw new Error('This is not a Todoist CSV file: its first row should start with TYPE,CONTENT.');
  }

  const drafts: Draft[] = [];
  /** The latest task at each indent level, so an indented task finds its parent. */
  const levels: number[] = [];
  let section: string | undefined;
  let last: Draft | undefined;
  let unreadable = 0;
  let sectioned = 0;
  let deadlinesKept = 0;

  for (const cells of rows) {
    const get = (column: Column) => cells[columns.get(column) ?? -1]?.trim() ?? '';
    const type = get('TYPE').toLowerCase();
    const content = get('CONTENT');

    if (type === 'section') {
      section = content || undefined;
      levels.length = 0;
      last = undefined;
      continue;
    }
    if (type === 'note') {
      if (last && content) addComment(last.edits, last.extra, content);
      continue;
    }
    // Also skips meta rows (view_style) and the blank rows between parts.
    if (type !== 'task' || !content) continue;

    const labels: string[] = [];
    const summary = content
      .replace(/(^|\s)@([^\s@]+)/g, (_, space: string, label: string) => {
        labels.push(label);
        return space;
      })
      .replace(/\s+/g, ' ')
      .trim();
    if (section) sectioned++;

    const priority = Number(get('PRIORITY'));
    const draft: Draft = {
      edits: {
        summary: summary || content,
        description: get('DESCRIPTION'),
        // Todoist's rule: an empty PRIORITY is p1.
        priority: PRIORITIES.find((p) => p === priority) ?? 1,
        categories: [...new Set(section ? [...labels, section] : labels)],
        location: '',
      },
      extra: [],
    };

    const dateText = get('DATE');
    const date = dateText ? parseTodoistDate(dateText, now) : undefined;
    if (dateText && !date) {
      draft.extra.push(`Todoist date: ${dateText}`);
      unreadable++;
    }
    const deadlineText = get('DEADLINE');
    const deadline = deadlineText ? parseTodoistDate(deadlineText, now) : undefined;
    const deadlineDay = deadline && !deadline.recurrence ? deadline.due.date : undefined;
    if (deadlineText && !deadlineDay) {
      draft.extra.push(`Deadline: ${deadlineText}`);
      unreadable++;
    }
    const unit = get('DURATION_UNIT').toLowerCase();
    const minutes = unit === '' || unit === 'minute' ? Number(get('DURATION')) : 0;
    const keptDeadline = setSchedule(draft.edits, date, minutes, deadlineDay);
    if (keptDeadline) {
      draft.extra.push(`Deadline: ${keptDeadline}`);
      deadlinesKept++;
    }

    const indent = Math.max(1, Math.trunc(Number(get('INDENT'))) || 1);
    draft.parent = levels.slice(0, indent - 1).findLast((index) => index !== undefined);
    levels.length = indent - 1;
    levels[indent - 1] = drafts.length;
    drafts.push(draft);
    last = draft;
  }

  // Parents come before their sub-tasks in the file, so each parent's UID is known when a child needs it.
  const uids: string[] = [];
  const items: ImportItem[] = drafts.map(({ edits, parent, extra }) => {
    const description = [edits.description, ...extra].filter(Boolean).join('\n\n');
    const { uid, ics } = newTaskIcs({ ...edits, description }, { parentUid: parent === undefined ? undefined : uids[parent] });
    uids.push(uid);
    return { uid, summary: edits.summary, ics };
  });

  const warnings: string[] = [];
  if (unreadable > 0) {
    warnings.push(`${plural(unreadable, 'date')} could not be read, so ${unreadable === 1 ? 'it was' : 'they were'} added to the description instead.`);
  }
  if (deadlinesKept > 0) {
    warnings.push(`${plural(deadlinesKept, 'task')} had both a date and a deadline; the deadline was added to the description.`);
  }
  if (sectioned > 0) warnings.push('Tasks in a Todoist section get the section name as a label.');
  return { items, warnings };
}
