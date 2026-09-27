import ICAL from 'ical.js';

/** Todoist-style priority: 1 is the highest (red), 4 means no priority. */
export type Priority = 1 | 2 | 3 | 4;

/** A date in local time: `date` is yyyy-mm-dd, `time` (optional) is HH:mm. */
export interface LocalDate {
  date: string;
  time?: string;
}

export interface Task {
  /** Path of the .ics file on the CalDAV server. */
  href: string;
  etag: string;
  /** The full iCalendar text, kept so edits only touch the fields ToDoDAV knows about. */
  ics: string;
  uid: string;
  summary: string;
  description: string;
  due?: LocalDate;
  start?: LocalDate;
  priority: Priority;
  completed: boolean;
  status?: string;
  percentComplete?: number;
  categories: string[];
  location?: string;
  url?: string;
  created?: Date;
  lastModified?: Date;
  completedAt?: Date;
}

/**
 * The fields the task modal can change. `start` and `due` are both all-day (no `time`) or both timed:
 * RFC 5545 requires DTSTART and DUE to have the same value type.
 */
export interface TaskEdits {
  summary: string;
  description: string;
  start?: LocalDate;
  due?: LocalDate;
  priority: Priority;
  categories: string[];
  location: string;
}

// iCalendar PRIORITY is 1 (highest) to 9 (lowest), 0 = undefined. Same mapping as Tasks.org / DAVx5.
function priorityFromIcal(value: number): Priority {
  if (value >= 1 && value <= 4) return 1;
  if (value === 5) return 2;
  if (value >= 6 && value <= 9) return 3;
  return 4;
}
const PRIORITY_TO_ICAL: Record<Priority, number> = { 1: 1, 2: 5, 3: 9, 4: 0 };

function parse(ics: string) {
  const vcalendar = new ICAL.Component(ICAL.parse(ics));
  // Register the time zones shipped in the file so TZID times convert correctly.
  for (const vtimezone of vcalendar.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(vtimezone);
    } catch {
      // A broken VTIMEZONE only makes times fall back to floating local time.
    }
  }
  const vtodo = vcalendar.getFirstSubcomponent('vtodo');
  if (!vtodo) throw new Error('No VTODO in calendar object');
  return { vcalendar, vtodo };
}

const pad = (n: number) => String(n).padStart(2, '0');

function toLocalDate(value: unknown): LocalDate | undefined {
  if (!(value instanceof ICAL.Time)) return undefined;
  if (value.isDate) return { date: `${value.year}-${pad(value.month)}-${pad(value.day)}` };
  const d = value.toJSDate();
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function toDate(value: unknown): Date | undefined {
  return value instanceof ICAL.Time ? value.toJSDate() : undefined;
}

export function parseTask(href: string, etag: string, ics: string): Task {
  const { vtodo } = parse(ics);
  const text = (name: string) => {
    const value = vtodo.getFirstPropertyValue(name);
    return value == null ? undefined : String(value);
  };
  const status = text('status')?.toUpperCase();
  const percent = text('percent-complete');

  return {
    href,
    etag,
    ics,
    uid: text('uid') ?? href,
    summary: text('summary') ?? '',
    description: text('description') ?? '',
    due: toLocalDate(vtodo.getFirstPropertyValue('due')),
    start: toLocalDate(vtodo.getFirstPropertyValue('dtstart')),
    priority: priorityFromIcal(Number(text('priority') ?? 0)),
    completed: status === 'COMPLETED' || vtodo.hasProperty('completed'),
    status,
    percentComplete: percent === undefined ? undefined : Number(percent),
    categories: vtodo
      .getAllProperties('categories')
      .flatMap((property) => property.getValues().map(String))
      .filter(Boolean),
    location: text('location'),
    url: text('url'),
    created: toDate(vtodo.getFirstPropertyValue('created')),
    lastModified: toDate(vtodo.getFirstPropertyValue('last-modified')),
    completedAt: toDate(vtodo.getFirstPropertyValue('completed')),
  };
}

const nowUtc = () => ICAL.Time.fromJSDate(new Date(), true);

/** Marks the task as changed, as RFC 5545 expects from every client that edits it. */
function touch(vtodo: ICAL.Component) {
  vtodo.updatePropertyWithValue('dtstamp', nowUtc());
  vtodo.updatePropertyWithValue('last-modified', nowUtc());
  vtodo.updatePropertyWithValue('sequence', Number(vtodo.getFirstPropertyValue('sequence') ?? 0) + 1);
}

function setText(vtodo: ICAL.Component, name: string, value: string) {
  if (value) vtodo.updatePropertyWithValue(name, value);
  else vtodo.removeAllProperties(name);
}

export const sameDate = (a?: LocalDate, b?: LocalDate) => a?.date === b?.date && a?.time === b?.time;

/** All-day dates become DATE values; timed ones become UTC DATE-TIME values. */
function setDate(vtodo: ICAL.Component, name: string, value: LocalDate | undefined) {
  vtodo.removeAllProperties(name);
  if (!value) return;
  vtodo.addPropertyWithValue(
    name,
    value.time ? ICAL.Time.fromJSDate(new Date(`${value.date}T${value.time}`), true) : ICAL.Time.fromDateString(value.date),
  );
}

/** Writes the editable fields into a VTODO. `previous` is the task as loaded (absent for a new task). */
function writeEdits(vtodo: ICAL.Component, edits: TaskEdits, previous?: Task) {
  setText(vtodo, 'summary', edits.summary.trim());
  setText(vtodo, 'description', edits.description.trim());

  // Only rewrite a date when it changed, so an untouched one keeps its original time zone.
  if (!sameDate(edits.start, previous?.start)) setDate(vtodo, 'dtstart', edits.start);
  if (!sameDate(edits.due, previous?.due)) {
    vtodo.removeAllProperties('duration'); // DUE and DURATION cannot coexist
    setDate(vtodo, 'due', edits.due);
  }

  if (edits.priority === 4) vtodo.removeAllProperties('priority');
  else vtodo.updatePropertyWithValue('priority', PRIORITY_TO_ICAL[edits.priority]);

  vtodo.removeAllProperties('categories');
  if (edits.categories.length > 0) {
    const categories = new ICAL.Property('categories');
    categories.setValues(edits.categories);
    vtodo.addProperty(categories);
  }

  // Coordinates written by other apps (Apple Reminders, GEO) describe the old text, so they go with it.
  const location = edits.location.trim();
  if (location !== (previous?.location?.trim() ?? '')) {
    setText(vtodo, 'location', location);
    vtodo.removeAllProperties('x-apple-structured-location');
    vtodo.removeAllProperties('geo');
  }
}

/** Returns the task's iCalendar text with the edits applied; every other property is kept as it was. */
export function applyEdits(task: Task, edits: TaskEdits): string {
  const { vcalendar, vtodo } = parse(task.ics);
  writeEdits(vtodo, edits, task);
  touch(vtodo);
  return vcalendar.toString();
}

/** A random UUID. crypto.randomUUID only exists on HTTPS/localhost; getRandomValues works everywhere. */
function newUid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** iCalendar text for a brand-new open task, and the UID it was given. */
export function newTaskIcs(edits: TaskEdits): { uid: string; ics: string } {
  const uid = newUid();
  const vcalendar = new ICAL.Component('vcalendar');
  vcalendar.updatePropertyWithValue('version', '2.0');
  vcalendar.updatePropertyWithValue('prodid', '-//ToDoDAV//EN');

  const vtodo = new ICAL.Component('vtodo');
  vcalendar.addSubcomponent(vtodo);
  vtodo.updatePropertyWithValue('uid', uid);
  vtodo.updatePropertyWithValue('dtstamp', nowUtc());
  vtodo.updatePropertyWithValue('created', nowUtc());
  vtodo.updatePropertyWithValue('last-modified', nowUtc());
  vtodo.updatePropertyWithValue('status', 'NEEDS-ACTION');
  writeEdits(vtodo, edits);

  return { uid, ics: vcalendar.toString() };
}

/** Returns the task's iCalendar text marked as completed (or as open again). */
export function withCompleted(task: Task, completed: boolean): string {
  const { vcalendar, vtodo } = parse(task.ics);
  if (completed) {
    vtodo.updatePropertyWithValue('status', 'COMPLETED');
    vtodo.updatePropertyWithValue('completed', nowUtc());
    vtodo.updatePropertyWithValue('percent-complete', 100);
  } else {
    vtodo.updatePropertyWithValue('status', 'NEEDS-ACTION');
    vtodo.removeAllProperties('completed');
    vtodo.removeAllProperties('percent-complete');
  }
  touch(vtodo);
  return vcalendar.toString();
}
