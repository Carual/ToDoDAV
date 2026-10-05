import type { ImportItem } from './icsFile.ts';
import { newTaskIcs, type LocalDate, type Priority, type TaskEdits } from './tasks.ts';
import { addComment, setSchedule } from './todoist.ts';
import { parseTodoistDate, type TodoistDate } from './todoistDates.ts';

// Todoist's API (v1): https://developer.todoist.com/api/v1/. The browser calls it directly (it allows CORS), so
// the token never passes through the ToDoDAV server; the backend's CSP allows connect-src to this host only.
const API = 'https://api.todoist.com/api/v1';

/** Where the user finds their API token. */
export const TOKEN_PAGE = 'https://app.todoist.com/app/settings/integrations/developer';

interface Due {
  /** yyyy-mm-dd (all day), yyyy-mm-ddTHH:mm:ss (floating), or in UTC with a Z when the task has a time zone. */
  date: string;
  string?: string;
  is_recurring?: boolean;
}

interface ApiTask {
  id: string;
  project_id: string;
  section_id?: string | null;
  parent_id?: string | null;
  content: string;
  description?: string;
  /** 4 is Todoist's p1 (red), 1 is no priority. */
  priority?: number;
  due?: Due | null;
  deadline?: { date: string } | null;
  duration?: { amount: number; unit: string } | null;
  labels?: string[];
  checked?: boolean;
  is_deleted?: boolean;
  added_at?: string | null;
  completed_at?: string | null;
}

interface ApiNote {
  item_id: string;
  content?: string;
  file_attachment?: { file_name?: string; file_url?: string } | null;
  is_deleted?: boolean;
  posted_at?: string;
}

interface ApiProject {
  id: string;
  name: string;
  color?: string;
  parent_id?: string | null;
  inbox_project?: boolean;
  is_deleted?: boolean;
  is_archived?: boolean;
}

interface ApiSection {
  id: string;
  name: string;
  is_deleted?: boolean;
}

interface SyncResponse {
  projects?: ApiProject[];
  items?: ApiTask[];
  sections?: ApiSection[];
  notes?: ApiNote[];
  user?: { joined_at?: string };
}

export interface TodoistProject {
  id: string;
  /** With its parent projects: "Work › Client". */
  name: string;
  /** Just the project's own name, for a new list. */
  shortName: string;
  /** Hex, for a new list. */
  color?: string;
  inbox: boolean;
}

/** What one request tells about the account: its projects and every open task, with comments and sections. */
export interface TodoistAccount {
  projects: TodoistProject[];
  tasks: ApiTask[];
  sections: Map<string, string>;
  notes: Map<string, ApiNote[]>;
  /** How far back the completed history can go. */
  joinedAt: Date;
}

/** Completed tasks, as the history endpoint lists them. */
export type CompletedTask = ApiTask;

export class TodoistError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TodoistError';
    this.status = status;
  }
}

// Todoist's names for its project colors (https://developer.todoist.com/api/v1/#tag/Colors).
const COLORS: Record<string, string> = {
  berry_red: '#b8255f',
  red: '#db4035',
  orange: '#ff9933',
  yellow: '#fad000',
  olive_green: '#afb83b',
  lime_green: '#7ecc49',
  green: '#299438',
  mint_green: '#6accbc',
  teal: '#158fad',
  sky_blue: '#14aaf5',
  light_blue: '#96c3eb',
  blue: '#4073ff',
  grape: '#884dff',
  violet: '#af38eb',
  lavender: '#eb96eb',
  magenta: '#e05194',
  salmon: '#ff8d85',
  charcoal: '#808080',
  grey: '#b8b8b8',
  taupe: '#ccac93',
};

const DAY = 86_400_000;
/** The history endpoint takes at most about three months per request; it is walked in steps shorter than that. */
const HISTORY_STEP_DAYS = 80;
/** Todoist launched in 2007: the history never needs to go further back. */
const TODOIST_START = new Date('2007-01-01T00:00:00Z');

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

async function call<T>(token: string, path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  // Todoist answers 429 when it is asked too much, and a big history takes many requests. Its Retry-After header
  // is not readable from another origin, but the body says how long to wait.
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
        ...init,
        signal,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new TodoistError(0, 'Could not reach Todoist.');
    }
    if (response.ok) return (await response.json()) as T;

    const body = (await response.json().catch(() => null)) as { error?: string; error_extra?: { retry_after?: number } } | null;
    if (response.status === 429 && attempt < 5) {
      await wait(Math.min(Math.max(body?.error_extra?.retry_after ?? 30, 1), 120) * 1000, signal);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new TodoistError(response.status, "Todoist didn't accept this token. Copy it again from Todoist's settings.");
    }
    throw new TodoistError(response.status, `Todoist answered ${response.status}${body?.error ? `: ${body.error}` : '.'}`);
  }
}

/** Header values can't hold spaces or other characters; fetch would fail as if Todoist were unreachable. */
export const isTokenShaped = (token: string) => /^[\x21-\x7e]+$/.test(token);

/** Everything open in the account, in one request (a full sync), so it costs almost nothing of Todoist's limits. */
export async function fetchAccount(token: string, signal?: AbortSignal): Promise<TodoistAccount> {
  const body = new URLSearchParams({
    sync_token: '*',
    resource_types: JSON.stringify(['user', 'projects', 'items', 'sections', 'notes']),
  });
  const data = await call<SyncResponse>(token, '/sync', { method: 'POST', body }, signal);

  const live = <T extends { is_deleted?: boolean; is_archived?: boolean }>(list: T[] = []) =>
    list.filter((x) => !x.is_deleted && !x.is_archived);
  const apiProjects = live(data.projects);
  const byId = new Map(apiProjects.map((p) => [p.id, p]));
  const path = (project: ApiProject): string[] => {
    const names: string[] = [];
    // The depth limit guards against a loop in the data.
    for (let p: ApiProject | undefined = project; p && names.length < 10; p = p.parent_id ? byId.get(p.parent_id) : undefined) {
      names.unshift(p.name);
    }
    return names;
  };
  const projects = apiProjects.map((p) => ({
    id: p.id,
    name: path(p).join(' › '),
    shortName: p.name,
    color: p.color ? COLORS[p.color] : undefined,
    inbox: p.inbox_project === true,
  }));
  // The Inbox first, then by name, which puts sub-projects right after their parent.
  projects.sort((a, b) => Number(b.inbox) - Number(a.inbox) || a.name.localeCompare(b.name));

  const notes = new Map<string, ApiNote[]>();
  for (const note of (data.notes ?? []).filter((n) => !n.is_deleted)) {
    notes.set(note.item_id, [...(notes.get(note.item_id) ?? []), note]);
  }
  for (const list of notes.values()) list.sort((a, b) => (a.posted_at ?? '').localeCompare(b.posted_at ?? ''));

  const joined = data.user?.joined_at ? new Date(data.user.joined_at) : TODOIST_START;
  return {
    projects,
    tasks: (data.items ?? []).filter((t) => !t.is_deleted && !t.checked),
    sections: new Map(live(data.sections).map((s) => [s.id, s.name])),
    notes,
    joinedAt: Number.isNaN(joined.getTime()) ? TODOIST_START : joined,
  };
}

/** Todoist wants whole seconds. */
const isoSeconds = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The tasks completed between `since` and `until`, walking back from `until` one date range at a time. Each
 * range is handed to `onStep` once it is complete, with the oldest date covered so far, so a stopped walk
 * still leaves a consistent part of the history. `onCount` reports the tasks found as pages come in.
 */
export async function fetchCompleted(
  token: string,
  since: Date,
  until: Date,
  { onStep, onCount, signal }: { onStep: (tasks: CompletedTask[], reached: Date) => void; onCount: (count: number) => void; signal?: AbortSignal },
): Promise<void> {
  let end = until;
  let stepDays = HISTORY_STEP_DAYS;
  let count = 0;
  while (end > since) {
    const start = new Date(Math.max(since.getTime(), end.getTime() - stepDays * DAY));
    const found: CompletedTask[] = [];
    let cursor: string | null = null;
    try {
      do {
        const query = new URLSearchParams({ since: isoSeconds(start), until: isoSeconds(end), limit: '200' });
        if (cursor) query.set('cursor', cursor);
        const page = await call<{ items?: CompletedTask[]; next_cursor?: string | null }>(
          token,
          `/tasks/completed/by_completion_date?${query}`,
          {},
          signal,
        );
        found.push(...(page.items ?? []));
        onCount(count + found.length);
        cursor = page.next_cursor ?? null;
      } while (cursor);
    } catch (error) {
      // A range too long for the endpoint: try again with a shorter one.
      if (error instanceof TodoistError && error.status === 400 && stepDays > 7) {
        stepDays = Math.floor(stepDays / 2);
        continue;
      }
      throw error;
    }
    count += found.length;
    onStep(found, start);
    end = start;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Todoist's due date as a local date. Floating times stay as written; a task with a time zone comes in UTC and is
 * shown in the browser's zone, as ToDoDAV shows every timed task.
 */
function localDue(date: string): LocalDate | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(date);
  if (!match) return undefined;
  const [, day, hours, minutes, zone] = match;
  if (!hours) return { date: day! };
  if (!zone) return { date: day!, time: `${hours}:${minutes}` };
  const offset = zone === 'Z' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
  const at = new Date(`${day}T${hours}:${minutes}:00${offset}`);
  if (Number.isNaN(at.getTime())) return undefined;
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

/** Todoist numbers priorities the other way round: its 4 (p1, red) is the app's 1. */
const priorityOf = (value = 1): Priority => (Math.min(4, Math.max(1, 5 - value)) as Priority);

/** Stable, so importing the same account again finds the tasks already there, and sub-tasks find their parent. */
export const todoistUid = (id: string) => `todoist-${id}`;

/** What the conversion could not carry over as it was, counted per project so the chosen ones can be summed. */
export interface ConversionNotes {
  /** Repeats in words the parser doesn't know; kept in the description. */
  unreadRepeats: number;
  /** `every!` repeats (from the completion date), which became repeats on fixed dates. */
  fromCompletion: number;
  /** Tasks with both a date and a deadline; the deadline went in the description. */
  deadlinesKept: number;
  /** Tasks in a section, which got the section's name as a label. */
  sectioned: number;
}

/** A task ready to be stored, with what its conversion lost, so the summary counts only the tasks chosen. */
export interface ConvertedItem extends ImportItem {
  completedAt?: Date;
  notes: ConversionNotes;
}

export interface ProjectItems {
  open: ConvertedItem[];
  completed: ConvertedItem[];
}

export const noNotes = (): ConversionNotes => ({ unreadRepeats: 0, fromCompletion: 0, deadlinesKept: 0, sectioned: 0 });

export function addNotes(a: ConversionNotes, b: ConversionNotes): ConversionNotes {
  return {
    unreadRepeats: a.unreadRepeats + b.unreadRepeats,
    fromCompletion: a.fromCompletion + b.fromCompletion,
    deadlinesKept: a.deadlinesKept + b.deadlinesKept,
    sectioned: a.sectioned + b.sectioned,
  };
}

function convert(task: ApiTask, account: TodoistAccount, now: Date): ConvertedItem {
  const notes = noNotes();
  const section = task.section_id ? account.sections.get(task.section_id) : undefined;
  if (section) notes.sectioned++;
  const edits: TaskEdits = {
    summary: task.content.trim(),
    description: task.description ?? '',
    priority: priorityOf(task.priority),
    categories: [...new Set([...(task.labels ?? []), ...(section ? [section] : [])])],
    location: '',
  };
  const extra: string[] = [];

  let date: TodoistDate | undefined;
  const due = task.due ? localDue(task.due.date) : undefined;
  if (task.due && !due) extra.push(`Todoist date: ${task.due.string || task.due.date}`);
  if (due) {
    date = { due };
    // The API gives the next date exactly, but a repeat only in words ("every friday"), read as the CSV's are.
    if (task.due?.is_recurring) {
      const words = task.due.string ?? '';
      // every! repeats from the completion date, which iCalendar can't say: the nearest is a fixed repeat.
      const fromCompletion = /\b(every|cada)!/i.test(words);
      const recurrence = parseTodoistDate(words.replace(/\b(every|cada)!/gi, '$1'), now)?.recurrence;
      if (recurrence) {
        date.recurrence = recurrence;
        if (fromCompletion) notes.fromCompletion++;
      } else {
        extra.push(`Todoist repeat: ${words}`);
        notes.unreadRepeats++;
      }
    }
  }
  const minutes = task.duration?.unit === 'minute' ? task.duration.amount : 0;
  const keptDeadline = setSchedule(edits, date, minutes, task.deadline?.date);
  if (keptDeadline) {
    extra.push(`Deadline: ${keptDeadline}`);
    notes.deadlinesKept++;
  }

  for (const note of account.notes.get(task.id) ?? []) {
    const file = note.file_attachment?.file_url
      ? `[${note.file_attachment.file_name || 'Attachment'}](${note.file_attachment.file_url})`
      : '';
    const content = [note.content?.trim(), file].filter(Boolean).join('\n');
    if (content) addComment(edits, extra, content);
  }

  const description = [edits.description, ...extra].filter(Boolean).join('\n\n');
  const completedAt = dateOf(task.completed_at);
  const { uid, ics } = newTaskIcs(
    { ...edits, description },
    {
      uid: todoistUid(task.id),
      parentUid: task.parent_id ? todoistUid(task.parent_id) : undefined,
      created: dateOf(task.added_at),
      completedAt,
    },
  );
  return { uid, summary: edits.summary, ics, completedAt, notes };
}

function dateOf(text: string | null | undefined): Date | undefined {
  const date = text ? new Date(text) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

/**
 * The completed tasks worth importing, each once, completed since `since`. Completed tasks sharing an id with an
 * open task are the past occurrences of a repeating task, which Todoist keeps as one task that moves along, as
 * ToDoDAV does: only the open task is kept. A task completed several times keeps its latest completion.
 */
export function completedSince(account: TodoistAccount, completed: CompletedTask[], since: Date): CompletedTask[] {
  const openIds = new Set(account.tasks.map((t) => t.id));
  const latest = new Map<string, { task: CompletedTask; at: number }>();
  for (const task of completed) {
    const at = dateOf(task.completed_at)?.getTime();
    if (at === undefined || at < since.getTime() || openIds.has(task.id) || task.is_deleted) continue;
    const seen = latest.get(task.id);
    if (!seen || seen.at < at) latest.set(task.id, { task, at });
  }
  return [...latest.values()].map(({ task }) => task);
}

/** The account's open tasks and the given completed ones (from `completedSince`) as calendar objects, per project. */
export function convertAccount(account: TodoistAccount, completed: CompletedTask[], now = new Date()): Map<string, ProjectItems> {
  const result = new Map<string, ProjectItems>();
  const of = (projectId: string) => {
    let entry = result.get(projectId);
    if (!entry) result.set(projectId, (entry = { open: [], completed: [] }));
    return entry;
  };
  for (const task of account.tasks) of(task.project_id).open.push(convert(task, account, now));
  for (const task of completed) of(task.project_id).completed.push(convert(task, account, now));
  return result;
}
