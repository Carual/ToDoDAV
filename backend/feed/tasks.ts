import express, { type Router } from 'express';
import ICAL from 'ical.js';
import { basicAuth } from '../auth.ts';
import type { Config } from '../config.ts';
import { markdownToText, plainText } from '../../shared/markdown.ts';

const DAV = 'DAV:';
const CALDAV = 'urn:ietf:params:xml:ns:caldav';
const XML = 'application/xml; charset=utf-8';
const TIMEOUT_MS = 15_000;

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  `<d:propfind xmlns:d="${DAV}"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>`;

const REPORT_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  `<c:calendar-query xmlns:d="${DAV}" xmlns:c="${CALDAV}">` +
  '<d:prop><c:calendar-data/></d:prop>' +
  '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter>' +
  '</c:calendar-query>';

/**
 * VTODO properties that mean the same in a VEVENT. SUMMARY and DESCRIPTION are rewritten (their Markdown as
 * plain text); everything else (PRIORITY, CATEGORIES, X-...) is dropped.
 */
const COPIED = ['uid', 'dtstamp', 'sequence', 'created', 'last-modified', 'location', 'url', 'class', 'rrule', 'rdate', 'exdate', 'recurrence-id'];
const REPEAT = new Set(['rrule', 'rdate', 'exdate']);

/**
 * /feed/tasks/<path>: one task list as a calendar of events, because Google Calendar ignores VTODOs.
 * The path must be a single calendar; anything else answers 404.
 */
export function tasksFeed(config: Config): Router {
  const authorization = basicAuth(config.username, config.password);
  const router = express.Router();

  router.use(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    let calendar: TaskList | undefined;
    try {
      calendar = await readTaskList(new URL(req.path.slice(1), config.caldavUrl), authorization);
    } catch (error) {
      console.error('Tasks feed: could not read the CalDAV server:', error);
      res.status(502).json({ error: 'caldav_unavailable' });
      return;
    }
    if (!calendar) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    res
      .attachment(calendarFileName(calendar.name, req.path))
      .type('text/calendar; charset=utf-8')
      .set('Cache-Control', 'no-cache')
      .send(toEventCalendar(calendar));
  });

  return router;
}

/**
 * "<display name>.ics", or the calendar's last path segment when it has no name.
 * Path separators and control characters are replaced so the name is always a plain file name.
 */
export function calendarFileName(name: string | undefined, path: string): string {
  const segment = path.split('/').filter(Boolean).pop() ?? '';
  let fallback: string;
  try {
    fallback = decodeURIComponent(segment);
  } catch {
    fallback = segment;
  }
  const base = (name || fallback || 'calendar').replace(/[\\/\u0000-\u001f\u007f]/g, '_');
  return `${base}.ics`;
}

interface TaskList {
  name?: string;
  /** iCalendar text of every calendar object holding a VTODO. */
  objects: string[];
}

/** `undefined` when the path is not a calendar (or the server will not say). */
async function readTaskList(url: URL, authorization: string): Promise<TaskList | undefined> {
  const found = await dav('PROPFIND', url, authorization, '0', PROPFIND_BODY);
  if (found.status === 403 || found.status === 404) return undefined;
  if (found.status !== 207) throw new Error(`PROPFIND answered ${found.status}`);
  const props = await found.text();
  const resourceType = elementTexts(props, 'resourcetype')[0] ?? '';
  if (!/<(?:[\w.-]+:)?calendar[\s/>]/.test(resourceType)) return undefined;

  const report = await dav('REPORT', url, authorization, '1', REPORT_BODY);
  if (report.status !== 207) throw new Error(`REPORT answered ${report.status}`);
  return {
    name: elementTexts(props, 'displayname')[0]?.trim() || undefined,
    objects: elementTexts(await report.text(), 'calendar-data'),
  };
}

function dav(method: string, url: URL, authorization: string, depth: string, body: string): Promise<Response> {
  return fetch(url, {
    method,
    headers: { Authorization: authorization, Depth: depth, 'Content-Type': XML },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Text of every element with this local name, whatever its namespace prefix. There is no DOMParser on the
 * server, and the elements read here hold no nested element of the same name, so a regex is enough and
 * spares an XML dependency.
 */
function elementTexts(xml: string, name: string): string[] {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?(?<!/)>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, 'g');
  return Array.from(xml.matchAll(pattern), (match) => unescapeXml(match[1] ?? ''));
}

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function unescapeXml(text: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(text);
  if (cdata) return cdata[1] ?? '';
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, code: string) => {
    if (code[0] === '#') return String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return XML_ENTITIES[code] ?? entity;
  });
}

function toEventCalendar(list: TaskList): string {
  const out = new ICAL.Component('vcalendar');
  out.addPropertyWithValue('version', '2.0');
  out.addPropertyWithValue('prodid', '-//ToDoDAV//Tasks feed//EN');
  if (list.name) out.addPropertyWithValue('x-wr-calname', list.name);
  // A refresh hint. Google ignores it and refreshes on its own schedule; Apple Calendar honors it.
  out.addPropertyWithValue('x-published-ttl', 'PT1H');

  const timezones = new Map<string, ICAL.Component>();
  const events: ICAL.Component[] = [];
  for (const ics of list.objects) {
    let vcalendar: ICAL.Component;
    try {
      vcalendar = new ICAL.Component(ICAL.parse(ics));
    } catch {
      continue; // One broken object must not take the whole feed down.
    }
    for (const vtimezone of vcalendar.getAllSubcomponents('vtimezone')) {
      const tzid = String(vtimezone.getFirstPropertyValue('tzid') ?? '');
      if (!tzid || timezones.has(tzid)) continue;
      timezones.set(tzid, vtimezone);
      try {
        // Needed to compare DTSTART and DUE given in different time zones.
        ICAL.TimezoneService.register(vtimezone);
      } catch {
        // A broken VTIMEZONE only makes that comparison fall back to floating time.
      }
    }

    // Overrides (RECURRENCE-ID) of a repeating task only make sense next to its master event.
    const vtodos = vcalendar.getAllSubcomponents('vtodo');
    const master = vtodos.find((vtodo) => !vtodo.hasProperty('recurrence-id'));
    const converted = vtodos.map(toEvent);
    if (master && !converted[vtodos.indexOf(master)]) continue;
    for (const event of converted) if (event) events.push(event);
  }

  for (const vtimezone of timezones.values()) out.addSubcomponent(vtimezone);
  for (const event of events) out.addSubcomponent(event);
  return out.toString();
}

/**
 * One VTODO as a VEVENT, or `undefined` when it does not belong in the feed.
 * - No due date: left out, a calendar has nowhere to put it.
 * - Cancelled: left out. For an override of a repeating task it stays as a cancelled occurrence instead,
 *   because leaving it out would bring back the master's occurrence on that date.
 * - Completed: kept, with "✓ " before the title, and without its repeat.
 * - Title and description: their Markdown as plain text, links as "text (address)".
 * - Start before due (same value type): spans start to due. Otherwise it sits on the due date alone.
 * - Timed: an instant (DTEND = DTSTART). All-day: DTEND is the next day, since DTEND is exclusive.
 * - Reminders (VALARM) are kept; the event is "free" so it never blocks time.
 */
function toEvent(vtodo: ICAL.Component): ICAL.Component | undefined {
  const due = dueOf(vtodo);
  if (!due) return undefined;

  const event = new ICAL.Component('vevent');
  const status = String(vtodo.getFirstPropertyValue('status') ?? '').toUpperCase();
  if (status === 'CANCELLED') {
    if (!vtodo.hasProperty('recurrence-id')) return undefined;
    event.addPropertyWithValue('status', 'CANCELLED');
  }

  const completed = status === 'COMPLETED' || vtodo.hasProperty('completed');
  for (const name of COPIED) {
    // A repeating task completed for good (ToDoDAV keeps its rule so reopening brings the repeat back) is
    // done once, not ticked off on every future date.
    if (completed && REPEAT.has(name)) continue;
    for (const property of vtodo.getAllProperties(name)) event.addProperty(copyAs(property, name));
  }
  if (!event.hasProperty('dtstamp')) event.addPropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));

  // Calendars show Markdown as typed, asterisks and all. Links keep their address, which Google Calendar
  // turns back into a link in the description and which can at least be copied from the title.
  const summary = plainText(String(vtodo.getFirstPropertyValue('summary') ?? ''), true);
  event.addPropertyWithValue('summary', completed ? `✓ ${summary}` : summary);
  const description = String(vtodo.getFirstPropertyValue('description') ?? '');
  if (description.trim()) event.addPropertyWithValue('description', markdownToText(description));

  const startProperty = vtodo.getFirstProperty('dtstart');
  const start = startProperty?.getFirstValue();
  const span = startProperty && start instanceof ICAL.Time && start.isDate === due.time.isDate && start.compare(due.time) < 0;
  event.addProperty(span ? copyAs(startProperty, 'dtstart', start) : copyAs(due.property, 'dtstart', due.time));

  const end = due.time.clone();
  if (end.isDate) end.adjust(1, 0, 0, 0);
  event.addProperty(copyAs(due.property, 'dtend', end));

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

/** A copy of a property under another name, keeping its parameters (TZID, VALUE=DATE...). */
function copyAs(property: ICAL.Property, name: string, value?: ICAL.Time): ICAL.Property {
  const jcal = structuredClone(property.toJSON());
  jcal[0] = name;
  const copy = new ICAL.Property(jcal);
  if (value) copy.setValue(value);
  return copy;
}
