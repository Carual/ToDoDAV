import ICAL from 'ical.js';
import { convertObject, copyAs, describe, endOf, titleOf, type EventOptions } from './event.ts';

/**
 * journals=1: the journal entries (VJOURNAL) of each calendar object as events, because Google Calendar ignores
 * VJOURNALs. jtx Board and similar apps keep them in the same calendars as tasks.
 */
export function journalEvents(options: EventOptions): (vcalendar: ICAL.Component) => ICAL.Component[] {
  return (vcalendar) => convertObject(vcalendar.getAllSubcomponents('vjournal'), (vjournal) => toEvent(vjournal, options));
}

/**
 * One VJOURNAL as a VEVENT, or `undefined` when it does not belong in the feed.
 * - No DTSTART: left out. That is a note (as jtx Board calls it), not an entry, and has no date to go on.
 * - Cancelled: left out. For an override of a repeating entry it stays as a cancelled occurrence instead, because
 *   leaving it out would bring back the master's occurrence on that date. Drafts and final entries are kept.
 * - Title and description: as for tasks. Several DESCRIPTIONs (allowed in a VJOURNAL) become one.
 * - On its DTSTART: timed, an instant or `duration` minutes long; all-day, DTEND is the next day (exclusive).
 * - Repeats are kept (an entry is never completed); the event is "free" so it never blocks time.
 */
function toEvent(vjournal: ICAL.Component, options: EventOptions): ICAL.Component | undefined {
  const startProperty = vjournal.getFirstProperty('dtstart');
  const start = startProperty?.getFirstValue();
  if (!startProperty || !(start instanceof ICAL.Time)) return undefined;

  const event = new ICAL.Component('vevent');
  if (String(vjournal.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') {
    if (!vjournal.hasProperty('recurrence-id')) return undefined;
    event.addPropertyWithValue('status', 'CANCELLED');
  }

  describe(event, vjournal, options, titleOf(vjournal));
  event.addProperty(copyAs(startProperty, 'dtstart', start));
  event.addProperty(copyAs(startProperty, 'dtend', endOf(start, false, options)));
  event.addPropertyWithValue('transp', 'TRANSPARENT');
  return event;
}
