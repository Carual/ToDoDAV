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
  /** UID of the task this one is a sub-task of (RELATED-TO). */
  parentUid?: string;
  /** The RRULE value (`FREQ=WEEKLY;BYDAY=FR`) when the task repeats; it counts from DTSTART, or else DUE. */
  recurrence?: string;
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
  /** The RRULE value, counting from `start`, or else `due`; absent when the task doesn't repeat. */
  recurrence?: string;
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
  // A repeating task can share its file with overrides of single occurrences (RECURRENCE-ID), in any order.
  const todos = vcalendar.getAllSubcomponents('vtodo');
  const vtodo = todos.find((todo) => !todo.hasProperty('recurrence-id')) ?? todos[0];
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

/** RELATED-TO without RELTYPE means PARENT (RFC 5545 3.2.15); CHILD and SIBLING links are not followed. */
function parentUidOf(vtodo: ICAL.Component): string | undefined {
  const parent = vtodo.getAllProperties('related-to').find((property) => {
    const reltype = property.getParameter('reltype');
    return !reltype || String(reltype).toUpperCase() === 'PARENT';
  });
  const value = parent?.getFirstValue();
  return value ? String(value) : undefined;
}

export function parseTask(href: string, etag: string, ics: string): Task {
  const { vtodo } = parse(ics);
  const text = (name: string) => {
    const value = vtodo.getFirstPropertyValue(name);
    return value == null ? undefined : String(value);
  };
  const status = text('status')?.toUpperCase();
  const percent = text('percent-complete');
  const rrule = vtodo.getFirstPropertyValue('rrule');

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
    parentUid: parentUidOf(vtodo),
    recurrence: rrule instanceof ICAL.Recur ? rrule.toString() : undefined,
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
  // Untouched, a rule stays exactly as written (other apps' rules can say more than the modal can show).
  const repeatRemoved = previous?.recurrence !== undefined && !edits.recurrence;
  if ((edits.recurrence ?? '') !== (previous?.recurrence ?? '')) {
    vtodo.removeAllProperties('rrule');
    if (edits.recurrence) vtodo.addPropertyWithValue('rrule', ICAL.Recur.fromString(edits.recurrence));
  }
  // A repeat counts from DTSTART or DUE; with neither left, it has nothing to count from.
  if (repeatRemoved || (!edits.start && !edits.due)) {
    for (const name of ['rrule', 'rdate', 'exdate']) vtodo.removeAllProperties(name);
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
  // Changed single occurrences (RECURRENCE-ID) mean nothing once the task no longer repeats.
  if (!vtodo.hasProperty('rrule') && !vtodo.hasProperty('rdate')) {
    for (const other of vcalendar.getAllSubcomponents('vtodo')) {
      if (other !== vtodo && other.hasProperty('recurrence-id')) vcalendar.removeSubcomponent(other);
    }
  }
  touch(vtodo);
  return vcalendar.toString();
}

/** A random UUID. crypto.randomUUID only exists on HTTPS/localhost; getRandomValues works everywhere. */
export function newUid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface NewTaskOptions {
  /** Makes it a sub-task of this task. */
  parentUid?: string;
  /** A UID that stays the same from one import to the next, so importing twice adds nothing. Random otherwise. */
  uid?: string;
  /** When the task was created, if earlier than now (an imported task). */
  created?: Date;
  /** Stores the task as completed at this time. */
  completedAt?: Date;
}

/** iCalendar text for a brand-new task (open unless `completedAt` says otherwise), and the UID it was given. */
export function newTaskIcs(
  edits: TaskEdits,
  { parentUid, uid = newUid(), created, completedAt }: NewTaskOptions = {},
): { uid: string; ics: string } {
  const vcalendar = new ICAL.Component('vcalendar');
  vcalendar.updatePropertyWithValue('version', '2.0');
  vcalendar.updatePropertyWithValue('prodid', '-//ToDoDAV//EN');

  const vtodo = new ICAL.Component('vtodo');
  vcalendar.addSubcomponent(vtodo);
  vtodo.updatePropertyWithValue('uid', uid);
  vtodo.updatePropertyWithValue('dtstamp', nowUtc());
  vtodo.updatePropertyWithValue('created', created ? ICAL.Time.fromJSDate(created, true) : nowUtc());
  vtodo.updatePropertyWithValue('last-modified', nowUtc());
  if (completedAt) {
    vtodo.updatePropertyWithValue('status', 'COMPLETED');
    vtodo.updatePropertyWithValue('completed', ICAL.Time.fromJSDate(completedAt, true));
    vtodo.updatePropertyWithValue('percent-complete', 100);
  } else vtodo.updatePropertyWithValue('status', 'NEEDS-ACTION');
  if (parentUid) {
    // PARENT is the default, but spelling it out is what Thunderbird and Tasks.org write too.
    const relatedTo = new ICAL.Property('related-to');
    relatedTo.setParameter('reltype', 'PARENT');
    relatedTo.setValue(parentUid);
    vtodo.addProperty(relatedTo);
  }
  writeEdits(vtodo, edits);

  return { uid, ics: vcalendar.toString() };
}

const SUB_DAILY = new Set(['HOURLY', 'MINUTELY', 'SECONDLY']);
const localDay = (value: ICAL.Time) => toLocalDate(value)!.date;
const dayString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Moves a date by whole days on the clock the task is shown in: 09:00 stays 09:00 across a DST change.
 * TZID and floating times move in their own zone; UTC times (what ToDoDAV writes) in the browser's.
 */
function shiftDays(value: ICAL.Time, days: number): ICAL.Time {
  if (value.isDate || value.zone !== ICAL.Timezone.utcTimezone) {
    const moved = value.clone();
    moved.adjust(days, 0, 0, 0);
    return moved;
  }
  const local = value.toJSDate();
  local.setDate(local.getDate() + days);
  return ICAL.Time.fromJSDate(local, true);
}

/**
 * The task moved to its next occurrence and open again, which is what completing a repeating task does (as
 * in Todoist, Tasks.org and Thunderbird): one VTODO that moves along, rather than one per occurrence. The
 * next occurrence is the first after the current one and after today, so an overdue task comes back once,
 * in the future. Start and due move together; skipped dates (EXDATE) are skipped. Returns null when the
 * repeat has no occurrence left (COUNT, UNTIL), so the task should be completed for good instead.
 */
export function withNextOccurrence(task: Task, now = new Date()): string | null {
  const { vcalendar, vtodo } = parse(task.ics);
  const ruleProperty = vtodo.getFirstProperty('rrule');
  const rule = ruleProperty?.getFirstValue();
  const anchorProperty = vtodo.getFirstProperty('dtstart') ?? vtodo.getFirstProperty('due');
  const anchor = anchorProperty?.getFirstValue();
  if (!ruleProperty || !(rule instanceof ICAL.Recur) || !(anchor instanceof ICAL.Time)) return null;

  const times = (name: string) =>
    vtodo
      .getAllProperties(name)
      .flatMap((property) => property.getValues())
      .filter((value): value is ICAL.Time => value instanceof ICAL.Time);
  const subDaily = SUB_DAILY.has(rule.freq);
  // Daily and longer rules step through days, so the time of day stays what the user sees. Keys are strings
  // that sort like the moments they stand for.
  const seconds = (s: number) => String(Math.floor(s)).padStart(12, '0');
  const keyOf = (t: ICAL.Time) => (subDaily ? seconds(t.toUnixTime()) : localDay(t));
  const excluded = new Set(times('exdate').map(keyOf));
  const floor = subDaily
    ? seconds(Math.max(anchor.toUnixTime(), now.getTime() / 1000))
    : [localDay(anchor), dayString(now)].sort().at(-1)!;
  const after = (key: string) => key > floor && !excluded.has(key);

  // The pattern alone; its end is checked below, by date.
  const pattern = rule.clone();
  pattern.count = null;
  pattern.until = null;
  const iterator = pattern.iterator(subDaily ? anchor : ICAL.Time.fromDateString(localDay(anchor)));
  /** Occurrences before the next one, the current one included: what COUNT has used up. */
  let used = 0;
  let next: ICAL.Time | undefined;
  for (let i = 0; i < 100_000; i++) {
    const occurrence = iterator.next();
    if (!occurrence) break;
    if (after(keyOf(occurrence))) {
      next = occurrence;
      break;
    }
    used++;
  }
  if (!next || (rule.count && used >= rule.count) || (rule.until && keyOf(next) > keyOf(rule.until))) return null;
  // Extra dates (RDATE) are left alone: moving DTSTART onto one would move what the rule leaves implicit
  // (FREQ=WEEKLY would follow the extra date's weekday). Task apps hardly ever write them.

  for (const name of ['dtstart', 'due']) {
    const property = vtodo.getFirstProperty(name);
    const value = property?.getFirstValue();
    if (!property || !(value instanceof ICAL.Time)) continue;
    if (subDaily) {
      const moved = value.clone();
      moved.addDuration(ICAL.Duration.fromSeconds(next.toUnixTime() - anchor.toUnixTime()));
      property.setValue(moved);
    } else {
      const days = Math.round((Date.parse(localDay(next)) - Date.parse(localDay(anchor))) / 86_400_000);
      property.setValue(shiftDays(value, days));
    }
  }
  // COUNT counts from DTSTART, which just moved past the used-up occurrences.
  if (rule.count) {
    const remaining = rule.clone();
    remaining.count = rule.count - used;
    ruleProperty.setValue(remaining);
  }

  vtodo.updatePropertyWithValue('status', 'NEEDS-ACTION');
  vtodo.removeAllProperties('completed');
  vtodo.removeAllProperties('percent-complete');
  touch(vtodo);
  return vcalendar.toString();
}

/** The task's earlier content saved again as a new revision (Undo), so other clients see it as newer. */
export function restoredTo(task: Task, ics: string): string {
  const { vcalendar, vtodo } = parse(ics);
  vtodo.updatePropertyWithValue('sequence', Number(parse(task.ics).vtodo.getFirstPropertyValue('sequence') ?? 0));
  touch(vtodo);
  return vcalendar.toString();
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
