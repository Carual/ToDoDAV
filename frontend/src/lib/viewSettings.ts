import type { Priority, Task } from '../api/tasks.ts';
import { describeDue } from './format.ts';

export function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembered settings are only a convenience.
  }
}

/** The details a task row can show under its title. */
export type RowField = 'description' | 'subtasks' | 'start' | 'due' | 'labels' | 'location';

export const ROW_FIELD_NAMES: Record<RowField, string> = {
  description: 'Description',
  subtasks: 'Sub-task count',
  start: 'Start date',
  due: 'Due date',
  labels: 'Labels',
  location: 'Location',
};

/** Description and location take a line of their own; the others are small items that share one. */
export const BLOCK_FIELDS: ReadonlySet<RowField> = new Set(['description', 'location']);

export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'dated' | 'undated';

export const DUE_FILTER_NAMES: Record<DueFilter, string> = {
  all: 'Any time',
  overdue: 'Overdue',
  today: 'Today and overdue',
  week: 'Next 7 days and overdue',
  dated: 'With a due date',
  undated: 'Without a due date',
};

export interface Filters {
  /** Priorities to show; all four when not filtering. */
  priorities: Priority[];
  due: DueFilter;
  /** Only tasks with this label; any task when absent. */
  label?: string;
}

export interface ListLayout {
  /** Sub-tasks indented under their parent; when off, every open task is listed at the top level. */
  nestSubtasks: boolean;
  /** Tasks without a due date before the dated ones instead of after them. */
  undatedFirst: boolean;
}

export interface ViewSettings {
  layout: ListLayout;
  filters: Filters;
  /** Row details in display order; hidden ones keep their place for when they are turned back on. */
  fields: { field: RowField; visible: boolean }[];
  /** A Google map of the location in the task modal. */
  showMap: boolean;
}

export const ALL_PRIORITIES: Priority[] = [1, 2, 3, 4];

export const DEFAULT_SETTINGS: ViewSettings = {
  layout: { nestSubtasks: true, undatedFirst: false },
  filters: { priorities: ALL_PRIORITIES, due: 'all' },
  fields: [
    { field: 'description', visible: true },
    { field: 'subtasks', visible: true },
    { field: 'start', visible: false },
    { field: 'due', visible: true },
    { field: 'labels', visible: true },
    { field: 'location', visible: true },
  ],
  // Off until asked: the map frame sends the location (and the user's Google cookies) to Google.
  showMap: false,
};

const SETTINGS_KEY = 'tododav.view';

/** Saved settings, cleaned up: unknown values are dropped and details added in later versions show up. */
export function loadSettings(): ViewSettings {
  let saved: Partial<ViewSettings> = {};
  try {
    saved = JSON.parse(readSetting(SETTINGS_KEY) ?? '{}') as Partial<ViewSettings>;
  } catch {
    // Unreadable settings fall back to the defaults.
  }
  const known = DEFAULT_SETTINGS.fields.map((f) => f.field);
  const fields = Array.isArray(saved.fields)
    ? saved.fields.filter((f, i, all) => known.includes(f?.field) && all.findIndex((o) => o.field === f.field) === i)
    : [];
  for (const f of DEFAULT_SETTINGS.fields) {
    if (!fields.some((o) => o.field === f.field)) fields.push(f);
  }

  const filters = saved.filters;
  const priorities = Array.isArray(filters?.priorities)
    ? ALL_PRIORITIES.filter((p) => filters.priorities.includes(p))
    : [];
  const layout = saved.layout;
  const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  return {
    layout: {
      nestSubtasks: flag(layout?.nestSubtasks, DEFAULT_SETTINGS.layout.nestSubtasks),
      undatedFirst: flag(layout?.undatedFirst, DEFAULT_SETTINGS.layout.undatedFirst),
    },
    filters: {
      priorities: priorities.length > 0 ? priorities : ALL_PRIORITIES,
      due: filters?.due && filters.due in DUE_FILTER_NAMES ? filters.due : 'all',
      label: typeof filters?.label === 'string' && filters.label ? filters.label : undefined,
    },
    fields: fields.map(({ field, visible }) => ({ field, visible: Boolean(visible) })),
    showMap: flag(saved.showMap, DEFAULT_SETTINGS.showMap),
  };
}

export function saveSettings(settings: ViewSettings) {
  saveSetting(SETTINGS_KEY, JSON.stringify(settings));
}

export function filtersActive(filters: Filters): boolean {
  return filters.priorities.length < ALL_PRIORITIES.length || filters.due !== 'all' || filters.label !== undefined;
}

function matchesDue(task: Task, due: DueFilter, now: Date): boolean {
  if (due === 'all') return true;
  if (due === 'dated' || due === 'undated') return (task.due !== undefined) === (due === 'dated');
  if (!task.due) return false;
  const { tone } = describeDue(task.due, now);
  if (due === 'overdue') return tone === 'overdue';
  if (due === 'today') return tone === 'overdue' || tone === 'today';
  return tone !== 'later';
}

export function matchesFilters(task: Task, filters: Filters, now = new Date()): boolean {
  return (
    filters.priorities.includes(task.priority) &&
    matchesDue(task, filters.due, now) &&
    (filters.label === undefined || task.categories.includes(filters.label))
  );
}

/** Short descriptions of the active filters, for the bar above a filtered list. */
export function describeFilters(filters: Filters): string[] {
  const parts: string[] = [];
  if (filters.priorities.length < ALL_PRIORITIES.length) {
    parts.push(`Priority ${filters.priorities.join(', ')}`);
  }
  if (filters.due !== 'all') parts.push(DUE_FILTER_NAMES[filters.due]);
  if (filters.label !== undefined) parts.push(`Label: ${filters.label}`);
  return parts;
}
