import ICAL from 'ical.js';
import { markdownToHtml, markdownToText, plainText } from '../../shared/markdown.ts';

/** How tasks and journal entries become events, from the feed's query string (feed/index.ts). */
export interface EventOptions {
  /** tasks=1: tasks become events. */
  tasks: boolean;
  /** journals=1: journal entries with a date become events. */
  journals: boolean;
  /** completed=0 leaves completed tasks out. */
  completed: boolean;
  /** subtasks=0 leaves out tasks whose parent is in the same list. */
  subtasks: boolean;
  /** priority=1,2: only tasks with these Todoist-style priorities (1 highest, 4 none). */
  priorities: number[];
  /** format=html: the description as the HTML Google Calendar renders, instead of plain text. */
  html: boolean;
  /** applinks=text: with format=html, app links (obsidian://) written as text and address, which Google would drop. */
  appLinksAsText: boolean;
  /** duration=30: timed tasks and entries last this many minutes instead of being an instant. */
  duration: number;
}

/**
 * VTODO and VJOURNAL properties that mean the same in a VEVENT. SUMMARY and DESCRIPTION are rewritten (their
 * Markdown as plain text); everything else (PRIORITY, CATEGORIES, X-...) is dropped.
 */
const COPIED = ['uid', 'dtstamp', 'sequence', 'created', 'last-modified', 'location', 'url', 'class', 'rrule', 'rdate', 'exdate', 'recurrence-id'];
const REPEAT = new Set(['rrule', 'rdate', 'exdate']);

/**
 * The properties an event takes from its task or journal entry, with `title` as its SUMMARY.
 * `repeat: false` leaves the repeat out (a task completed for good is done once, not on every future date).
 */
export function describe(event: ICAL.Component, source: ICAL.Component, options: EventOptions, title: string, repeat = true): void {
  for (const name of COPIED) {
    if (!repeat && REPEAT.has(name)) continue;
    for (const property of source.getAllProperties(name)) event.addProperty(copyAs(property, name));
  }
  if (!event.hasProperty('dtstamp')) event.addPropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));

  // Calendars show Markdown as typed, asterisks and all. Links keep their address, which Google Calendar
  // turns back into a link in the description and which can at least be copied from the title.
  // HTML in DESCRIPTION is not iCalendar, but Google Calendar renders it; other apps show the tags.
  event.addPropertyWithValue('summary', title);
  // A VJOURNAL may have several DESCRIPTIONs (RFC 5545 3.6.3); an event has one.
  const description = source
    .getAllProperties('description')
    .map((property) => String(property.getFirstValue() ?? ''))
    .filter((text) => text.trim())
    .join('\n\n');
  if (description) {
    event.addPropertyWithValue('description', options.html ? markdownToHtml(description, { appLinksAsText: options.appLinksAsText }) : markdownToText(description));
  }
}

/** A title's Markdown as plain text, links as "text (address)". */
export function titleOf(source: ICAL.Component): string {
  return plainText(String(source.getFirstPropertyValue('summary') ?? ''), true);
}

/**
 * DTEND for an event on `time`. All-day: the next day (exclusive). Timed: an instant, or `duration` minutes
 * long when it is not already a span.
 */
export function endOf(time: ICAL.Time, span: boolean, options: EventOptions): ICAL.Time {
  const end = time.clone();
  if (end.isDate) end.adjust(1, 0, 0, 0);
  // Google draws an instant as a sliver; a span already has its own length.
  else if (!span && options.duration > 0) end.addDuration(ICAL.Duration.fromSeconds(options.duration * 60));
  return end;
}

/**
 * The events of one calendar object, converted by `toEvent` component by component.
 * Overrides (RECURRENCE-ID) of a repeating item only make sense next to its master event, so when the master
 * converts to nothing, so does the whole object.
 */
export function convertObject(components: ICAL.Component[], toEvent: (component: ICAL.Component) => ICAL.Component | undefined): ICAL.Component[] {
  const master = masterOf(components);
  if (!master) return [];
  const converted = components.map(toEvent);
  if (!master.hasProperty('recurrence-id') && !converted[components.indexOf(master)]) return [];
  return converted.filter((event) => event !== undefined);
}

/** The component without RECURRENCE-ID (the one a repeat belongs to), or the first when all are overrides. */
export function masterOf(components: ICAL.Component[]): ICAL.Component | undefined {
  return components.find((component) => !component.hasProperty('recurrence-id')) ?? components[0];
}

/** A copy of a property under another name, keeping its parameters (TZID, VALUE=DATE...). */
export function copyAs(property: ICAL.Property, name: string, value?: ICAL.Time): ICAL.Property {
  const jcal = structuredClone(property.toJSON());
  jcal[0] = name;
  const copy = new ICAL.Property(jcal);
  if (value) copy.setValue(value);
  return copy;
}
