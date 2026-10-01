import type { Request, Response as ExpressResponse } from 'express';
import ICAL from 'ical.js';
import { basicAuth } from '../auth.ts';
import type { Config } from '../config.ts';
import type { EventOptions } from './event.ts';
import { journalEvents } from './journals.ts';
import { taskEvents } from './tasks.ts';

const DAV = 'DAV:';
const CALDAV = 'urn:ietf:params:xml:ns:caldav';
const XML = 'application/xml; charset=utf-8';
const TIMEOUT_MS = 15_000;

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  `<d:propfind xmlns:d="${DAV}"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>`;

// Every object: nested comp-filters would all have to match (RFC 4791 9.7.1), and VTODOs, VJOURNALs and
// VEVENTs are all wanted.
const REPORT_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  `<c:calendar-query xmlns:d="${DAV}" xmlns:c="${CALDAV}">` +
  '<d:prop><c:calendar-data/></d:prop>' +
  '<c:filter><c:comp-filter name="VCALENDAR"/></c:filter>' +
  '</c:calendar-query>';

/**
 * The feed with tasks=1 and/or journals=1: one calendar with its tasks and/or journal entries turned into
 * events (tasks.ts, journals.ts), because Google Calendar ignores both. Its own events stay as stored. The path
 * must be a single calendar; anything else answers 404.
 */
export function convertedCalendar(config: Config): (req: Request, res: ExpressResponse, options: EventOptions) => Promise<void> {
  const authorization = basicAuth(config.username, config.password);

  return async (req, res, options) => {
    let calendar: Calendar | undefined;
    try {
      calendar = await readCalendar(new URL(req.path.slice(1), config.caldavUrl), authorization);
    } catch (error) {
      console.error('Feed: could not read the CalDAV server:', error);
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
      .send(toEventCalendar(calendar, options));
  };
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

interface Calendar {
  name?: string;
  /** iCalendar text of every calendar object (tasks, events, journal entries, anything else it holds). */
  objects: string[];
}

/** `undefined` when the path is not a calendar (or the server will not say). */
async function readCalendar(url: URL, authorization: string): Promise<Calendar | undefined> {
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

function toEventCalendar(calendar: Calendar, options: EventOptions): string {
  const out = new ICAL.Component('vcalendar');
  out.addPropertyWithValue('version', '2.0');
  out.addPropertyWithValue('prodid', '-//ToDoDAV//Tasks feed//EN');
  if (calendar.name) out.addPropertyWithValue('x-wr-calname', calendar.name);
  // A refresh hint. Google ignores it and refreshes on its own schedule; Apple Calendar honors it.
  out.addPropertyWithValue('x-published-ttl', 'PT1H');

  const vcalendars: ICAL.Component[] = [];
  for (const ics of calendar.objects) {
    try {
      vcalendars.push(new ICAL.Component(ICAL.parse(ics)));
    } catch {
      // One broken object must not take the whole feed down.
    }
  }
  const tasks = options.tasks ? taskEvents(vcalendars, options) : () => [];
  const journals = options.journals ? journalEvents(options) : () => [];

  const timezones = new Map<string, ICAL.Component>();
  const events: ICAL.Component[] = [];
  for (const vcalendar of vcalendars) {
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

    // The calendar's own events are passed on untouched.
    events.push(...vcalendar.getAllSubcomponents('vevent'), ...tasks(vcalendar), ...journals(vcalendar));
  }

  for (const vtimezone of timezones.values()) out.addSubcomponent(vtimezone);
  for (const event of events) out.addSubcomponent(event);
  return out.toString();
}
