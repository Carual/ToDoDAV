import ICAL from 'ical.js';
import { newUid, type Task } from './tasks.ts';

/** One task ready to be stored: its own calendar object, as CalDAV wants it. */
export interface ImportItem {
  uid: string;
  summary: string;
  ics: string;
}

export interface ParsedImport {
  items: ImportItem[];
  /** Things the user should know, such as parts of the file that were left out. */
  warnings: string[];
}

const PRODID = '-//ToDoDAV//EN';

function newCalendar(): ICAL.Component {
  const vcalendar = new ICAL.Component('vcalendar');
  vcalendar.updatePropertyWithValue('version', '2.0');
  vcalendar.updatePropertyWithValue('prodid', PRODID);
  return vcalendar;
}

/**
 * One .ics file with every task of a list, exactly as stored: reminders, repeats and properties written by
 * other apps come along. Each time zone the tasks use is included once.
 */
export function tasksToIcs(tasks: Task[], name: string): string {
  const out = newCalendar();
  out.updatePropertyWithValue('x-wr-calname', name);
  const zones = new Map<string, ICAL.Component>();
  const todos: ICAL.Component[] = [];
  for (const task of tasks) {
    const vcalendar = new ICAL.Component(ICAL.parse(task.ics));
    for (const zone of vcalendar.getAllSubcomponents('vtimezone')) {
      const tzid = String(zone.getFirstPropertyValue('tzid'));
      if (!zones.has(tzid)) zones.set(tzid, zone);
    }
    // All of them: a repeating task can carry overrides of single occurrences (RECURRENCE-ID).
    todos.push(...vcalendar.getAllSubcomponents('vtodo'));
  }
  for (const component of [...zones.values(), ...todos]) out.addSubcomponent(component);
  return out.toString();
}

/** TZIDs a component's properties refer to, including those of its alarms. */
function tzidsOf(component: ICAL.Component, into = new Set<string>()): Set<string> {
  for (const property of component.getAllProperties()) {
    const tzid = property.getParameter('tzid');
    if (tzid) into.add(String(tzid));
  }
  for (const sub of component.getAllSubcomponents()) tzidsOf(sub, into);
  return into;
}

/**
 * The tasks of an .ics file, one calendar object per UID (a repeating task and its overrides share one).
 * UIDs are kept, so sub-tasks stay under their parents and a task already in the list can be recognized.
 */
export function icsToTasks(text: string): ParsedImport {
  let roots: unknown[];
  try {
    const parsed = ICAL.parse(text) as unknown[];
    // A single calendar comes back as one jCal component; several as a list of them.
    roots = typeof parsed[0] === 'string' ? [parsed] : parsed;
  } catch {
    throw new Error('This is not a valid iCalendar (.ics) file.');
  }

  const zones = new Map<string, ICAL.Component>();
  const groups = new Map<string, ICAL.Component[]>();
  let others = 0;
  for (const root of roots) {
    const vcalendar = new ICAL.Component(root as never);
    if (vcalendar.name !== 'vcalendar') continue;
    for (const component of vcalendar.getAllSubcomponents()) {
      if (component.name === 'vtimezone') {
        zones.set(String(component.getFirstPropertyValue('tzid')), component);
      } else if (component.name !== 'vtodo') {
        others++;
      } else {
        // A task without a UID is invalid iCalendar, but can still be imported under a new one.
        let uid = component.getFirstPropertyValue('uid');
        if (!uid) {
          uid = newUid();
          component.updatePropertyWithValue('uid', uid);
        }
        groups.set(String(uid), [...(groups.get(String(uid)) ?? []), component]);
      }
    }
  }
  if (roots.length === 0) throw new Error('This file is empty.');

  const items: ImportItem[] = [];
  for (const [uid, todos] of groups) {
    const out = newCalendar();
    const tzids = new Set<string>();
    for (const todo of todos) tzidsOf(todo, tzids);
    for (const tzid of tzids) {
      const zone = zones.get(tzid);
      if (zone) out.addSubcomponent(zone);
    }
    for (const todo of todos) {
      if (!todo.hasProperty('dtstamp')) todo.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));
      out.addSubcomponent(todo);
    }
    // The master (no RECURRENCE-ID) names the task; overrides only change single occurrences.
    const master = todos.find((t) => !t.hasProperty('recurrence-id')) ?? todos[0]!;
    items.push({ uid, summary: String(master.getFirstPropertyValue('summary') ?? ''), ics: out.toString() });
  }

  const warnings: string[] = [];
  if (others > 0) {
    warnings.push(`${others} ${others === 1 ? 'item that is not a task (an event, for example) is' : 'items that are not tasks (events, for example) are'} left out.`);
  }
  return { items, warnings };
}
