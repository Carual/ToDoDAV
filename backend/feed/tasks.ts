import ICAL from 'ical.js';
import { convertObject, copyAs, describe, endOf, masterOf, titleOf, type EventOptions } from './event.ts';

/**
 * tasks=1: the tasks (VTODO) of each calendar object as events, because Google Calendar ignores VTODOs.
 * Takes every object of the calendar first, since whether a task is a sub-task depends on the others.
 */
export function taskEvents(vcalendars: ICAL.Component[], options: EventOptions): (vcalendar: ICAL.Component) => ICAL.Component[] {
  const isSubtask = subtaskTest(vcalendars);
  return (vcalendar) => {
    const vtodos = vcalendar.getAllSubcomponents('vtodo');
    const master = masterOf(vtodos);
    // The filters look at the whole task (its master), so a repeating task is in or out as a whole.
    if (!master || !wanted(master, options, isSubtask)) return [];
    return convertObject(vtodos, (vtodo) => toEvent(vtodo, options));
  };
}

/** The priority filter and subtasks=0, on a task's master VTODO. completed=0 is per occurrence, in toEvent. */
function wanted(vtodo: ICAL.Component, options: EventOptions, isSubtask: (uid: string) => boolean): boolean {
  if (!options.priorities.includes(priorityOf(vtodo))) return false;
  return options.subtasks || !isSubtask(String(vtodo.getFirstPropertyValue('uid') ?? ''));
}

// iCalendar PRIORITY is 1 (highest) to 9 (lowest), 0 = undefined; the app's mapping (Tasks.org / DAVx5).
function priorityOf(vtodo: ICAL.Component): number {
  const value = Number(vtodo.getFirstPropertyValue('priority') ?? 0);
  if (value >= 1 && value <= 4) return 1;
  if (value === 5) return 2;
  if (value >= 6 && value <= 9) return 3;
  return 4;
}

/**
 * Whether a task is a sub-task as the app shows it: its parent (RELATED-TO with RELTYPE=PARENT or none) is in
 * this list, and it is not part of a loop written by another client (those show at the top level).
 */
function subtaskTest(vcalendars: ICAL.Component[]): (uid: string) => boolean {
  const parents = new Map<string, string | undefined>();
  for (const vcalendar of vcalendars) {
    const vtodo = vcalendar.getAllSubcomponents('vtodo').find((todo) => !todo.hasProperty('recurrence-id'));
    const uid = vtodo?.getFirstPropertyValue('uid');
    if (!vtodo || !uid) continue;
    const parent = vtodo.getAllProperties('related-to').find((property) => {
      const reltype = property.getParameter('reltype');
      return !reltype || String(reltype).toUpperCase() === 'PARENT';
    });
    const parentUid = parent?.getFirstValue();
    parents.set(String(uid), parentUid ? String(parentUid) : undefined);
  }

  return (uid) => {
    let current = parents.get(uid);
    if (current === undefined || !parents.has(current)) return false;
    const seen = new Set<string>();
    while (current !== undefined && parents.has(current) && !seen.has(current)) {
      if (current === uid) return false;
      seen.add(current);
      current = parents.get(current);
    }
    return true;
  };
}

/**
 * One VTODO as a VEVENT, or `undefined` when it does not belong in the feed.
 * - No due date: left out, a calendar has nowhere to put it.
 * - Cancelled (or completed, with completed=0): left out. For an override of a repeating task it stays as a
 *   cancelled occurrence instead, because leaving it out would bring back the master's occurrence on that date.
 * - Completed: kept, with "✓ " before the title, and without its repeat.
 * - Title: its Markdown as plain text, links as "text (address)". Description: the same, or HTML with format=html.
 * - Start before due (same value type): spans start to due. Otherwise it sits on the due date alone.
 * - Timed: an instant (DTEND = DTSTART), or `duration` minutes long. All-day: DTEND is the next day (exclusive).
 * - Reminders (VALARM) are kept; the event is "free" so it never blocks time.
 */
function toEvent(vtodo: ICAL.Component, options: EventOptions): ICAL.Component | undefined {
  const due = dueOf(vtodo);
  if (!due) return undefined;

  const event = new ICAL.Component('vevent');
  const status = String(vtodo.getFirstPropertyValue('status') ?? '').toUpperCase();
  const completed = status === 'COMPLETED' || vtodo.hasProperty('completed');
  if (status === 'CANCELLED' || (completed && !options.completed)) {
    if (!vtodo.hasProperty('recurrence-id')) return undefined;
    event.addPropertyWithValue('status', 'CANCELLED');
  }

  // A repeating task completed for good (ToDoDAV keeps its rule so reopening brings the repeat back) is
  // done once, not ticked off on every future date.
  const title = titleOf(vtodo);
  describe(event, vtodo, options, completed ? `✓ ${title}` : title, !completed);

  const startProperty = vtodo.getFirstProperty('dtstart');
  const start = startProperty?.getFirstValue();
  const span = startProperty && start instanceof ICAL.Time && start.isDate === due.time.isDate && start.compare(due.time) < 0;
  event.addProperty(span ? copyAs(startProperty, 'dtstart', start) : copyAs(due.property, 'dtstart', due.time));
  event.addProperty(copyAs(due.property, 'dtend', endOf(due.time, !!span, options)));

  event.addPropertyWithValue('transp', 'TRANSPARENT');
  for (const valarm of vtodo.getAllSubcomponents('valarm')) {
    event.addSubcomponent(new ICAL.Component(structuredClone(valarm.toJSON())));
  }
  return event;
}

/** The due time and the property it came from (whose TZID / VALUE=DATE the event reuses). */
function dueOf(vtodo: ICAL.Component): { property: ICAL.Property; time: ICAL.Time } | undefined {
  const due = vtodo.getFirstProperty('due');
  const dueTime = due?.getFirstValue();
  if (due && dueTime instanceof ICAL.Time) return { property: due, time: dueTime };

  // RFC 5545 also allows the due time as DTSTART + DURATION.
  const start = vtodo.getFirstProperty('dtstart');
  const startTime = start?.getFirstValue();
  const duration = vtodo.getFirstPropertyValue('duration');
  if (start && startTime instanceof ICAL.Time && duration instanceof ICAL.Duration) {
    const time = startTime.clone();
    time.addDuration(duration);
    return { property: start, time };
  }
  return undefined;
}
