import { DOMParser, type Element } from '@xmldom/xmldom';
import { newUid } from './ical.ts';
import { parseJournal, type Journal } from './journals.ts';
import { parseTask, type Task } from './tasks.ts';

export interface Credentials {
  username: string;
  password: string;
}

export interface Calendar {
  href: string;
  name: string;
  color?: string;
}

/** Settings of this ToDoDAV install, from the backend's /api/config. */
export interface ServerConfig {
  /** Present when the calendar feed (/feed/<token>/...) is enabled. */
  feed?: { token: string };
}

export const NO_FEEDS: ServerConfig = {};

/**
 * Where CalDAV requests go. `proxy`: through a ToDoDAV backend (/proxy/... on `origin`, '' for same-origin), the
 * only way in a browser. `direct`: straight to the CalDAV root `url`, which the phone apps can do since CORS
 * doesn't apply to them.
 */
export type Transport = { kind: 'proxy'; origin: string } | { kind: 'direct'; url: string };

/** The kinds of calendar objects ToDoDAV shows. */
export type Component = 'VTODO' | 'VJOURNAL';

/** The user's calendars that take tasks, and those that take journal entries (one can be in both). */
export interface Calendars {
  tasks: Calendar[];
  journals: Calendar[];
}

/** What every stored calendar object (a task, a journal entry) carries. */
export interface StoredObject {
  href: string;
  etag: string;
}

export class CalDavError extends Error {
  /** 0 means the server could not be reached. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'CalDavError';
    this.status = status;
  }
}

const DAV = 'DAV:';
const CALDAV = 'urn:ietf:params:xml:ns:caldav';
const APPLE = 'http://apple.com/ns/ical/';
const XML = 'application/xml; charset=utf-8';

interface DavResponse {
  href: string;
  element: Element;
}

function basicAuth({ username, password }: Credentials): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`;
}

function parseMultistatus(xml: string): DavResponse[] {
  let doc;
  try {
    // xmldom rather than the browser's DOMParser, which React Native doesn't have. Errors stop it, as they stop the
    // browser's; warnings (odd but readable input) are ignored, instead of xmldom logging them as console errors.
    doc = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') throw new Error(message);
      },
    }).parseFromString(xml, 'application/xml');
  } catch {
    throw new CalDavError(502, 'The CalDAV server sent an answer that is not valid XML.');
  }
  return Array.from(doc.getElementsByTagNameNS(DAV, 'response'), (element) => ({
    href: element.getElementsByTagNameNS(DAV, 'href')[0]?.textContent?.trim() ?? '',
    element,
  }));
}

/** A property from a response, only if the server reported it with a 2xx status. */
function prop(response: DavResponse, ns: string, name: string): Element | undefined {
  for (const propstat of Array.from(response.element.getElementsByTagNameNS(DAV, 'propstat'))) {
    const status = propstat.getElementsByTagNameNS(DAV, 'status')[0]?.textContent ?? '';
    if (!/\s2\d\d\s/.test(` ${status} `)) continue;
    const element = propstat.getElementsByTagNameNS(ns, name)[0];
    if (element) return element;
  }
  return undefined;
}

function hrefInside(element: Element | undefined): string | undefined {
  return element?.getElementsByTagNameNS(DAV, 'href')[0]?.textContent?.trim() || undefined;
}

/**
 * Talks CalDAV, either through the ToDoDAV backend (every request goes to /proxy/... and the backend forwards it to
 * the CalDAV server configured there) or straight to a CalDAV server. The requests are the same in both cases.
 */
export class CalDavClient {
  readonly username: string;
  readonly transport: Transport;
  private readonly authorization: string;
  /** Path of the CalDAV root on the server. Hrefs in responses start with it; /proxy/ maps onto it. */
  private basePath = '/';
  /** The user's calendar home (from discoverCalendars), where new lists are created. */
  private home: string | undefined;

  constructor(credentials: Credentials, transport: Transport = { kind: 'proxy', origin: '' }) {
    this.username = credentials.username;
    this.authorization = basicAuth(credentials);
    this.transport = transport;
  }

  /** Finds the user's task lists and journals. It is also the login check: wrong credentials throw a 401 CalDavError. */
  async discoverCalendars(): Promise<Calendars> {
    const [root] = await this.propfind(null, 0, '<d:current-user-principal/>');
    if (!root) throw new CalDavError(502, 'The CalDAV server gave an empty answer.');
    // The href of /proxy/ itself tells which server path the proxy maps to.
    this.basePath = root.href.endsWith('/') ? root.href : `${root.href}/`;

    const principal = hrefInside(prop(root, DAV, 'current-user-principal'));
    if (!principal) throw new CalDavError(502, 'The CalDAV server did not say who you are.');

    const [principalResponse] = await this.propfind(principal, 0, '<c:calendar-home-set/>');
    const home = (principalResponse && hrefInside(prop(principalResponse, CALDAV, 'calendar-home-set'))) ?? principal;
    this.home = home.endsWith('/') ? home : `${home}/`;

    const responses = await this.propfind(
      home,
      1,
      '<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><a:calendar-color/>',
    );
    const calendar = (response: DavResponse): Calendar => ({
      href: response.href,
      name: prop(response, DAV, 'displayname')?.textContent?.trim() || lastSegment(response.href),
      color: prop(response, APPLE, 'calendar-color')?.textContent?.trim().slice(0, 7) || undefined,
    });
    return {
      tasks: responses.filter((response) => supports(response, 'VTODO')).map(calendar),
      journals: responses.filter((response) => supports(response, 'VJOURNAL')).map(calendar),
    };
  }

  /**
   * Creates a new task list (or journal) in the calendar home (MKCALENDAR), limited to that one kind so calendar
   * apps don't offer it for events. Its path is random: display names are free text, and a path can't be renamed later.
   */
  async createCalendar(name: string, color?: string, component: Component = 'VTODO'): Promise<Calendar> {
    if (!this.home) throw new CalDavError(0, 'The task lists have not been loaded yet.');
    const href = `${this.home}${newUid()}/`;
    await this.send('MKCALENDAR', href, {
      headers: { 'Content-Type': XML },
      body:
        '<?xml version="1.0" encoding="utf-8"?>' +
        `<c:mkcalendar xmlns:d="${DAV}" xmlns:c="${CALDAV}" xmlns:a="${APPLE}"><d:set><d:prop>` +
        `<d:displayname>${escapeXml(name)}</d:displayname>` +
        (color ? `<a:calendar-color>${escapeXml(color)}</a:calendar-color>` : '') +
        `<c:supported-calendar-component-set><c:comp name="${component}"/></c:supported-calendar-component-set>` +
        '</d:prop></d:set></c:mkcalendar>',
    });
    return { href, name, color };
  }

  /**
   * All tasks (open and completed) of one list, or with `openOnly` those without a COMPLETED date. Not STATUS too:
   * a text-match on a property fails when the property is missing (RFC 4791 9.7.2), which would drop open tasks
   * without STATUS. A task with STATUS:COMPLETED and no date still comes back and shows as completed, and a server
   * that ignores the filter sends everything; both are still right.
   */
  async listTasks(calendarHref: string, { openOnly = false } = {}): Promise<Task[]> {
    const filter = openOnly ? '<c:prop-filter name="COMPLETED"><c:is-not-defined/></c:prop-filter>' : '';
    return (await this.query(calendarHref, 'VTODO', filter)).flatMap(({ href, etag, data }) => {
      try {
        return [parseTask(href, etag, data)];
      } catch {
        return []; // Skip objects that are not valid tasks instead of failing the whole list.
      }
    });
  }

  /** All journal entries and notes of one journal. */
  async listJournals(calendarHref: string): Promise<Journal[]> {
    return (await this.query(calendarHref, 'VJOURNAL')).flatMap(({ href, etag, data }) => {
      try {
        return [parseJournal(href, etag, data)];
      } catch {
        return [];
      }
    });
  }

  /**
   * Saves an object's new iCalendar text. Only succeeds if nobody changed it since it was loaded (If-Match);
   * otherwise throws a 412 CalDavError. Returns the new ETag.
   */
  async saveObject({ href, etag }: StoredObject, ics: string): Promise<string> {
    const response = await this.send('PUT', href, {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-Match': etag },
      body: ics,
    });
    // Some servers do not return the new ETag; an empty one makes the next save reload first.
    return response.headers.get('ETag') ?? '';
  }

  /** Where a new object with this UID goes in a calendar, known before it is stored so it can be shown at once. */
  objectHref(calendarHref: string, uid: string): string {
    return `${calendarHref.endsWith('/') ? calendarHref : `${calendarHref}/`}${encodeURIComponent(uid)}.ics`;
  }

  /** Stores a new object at `href` and returns its ETag. If-None-Match: * guarantees it never overwrites one. */
  async createObject(href: string, ics: string): Promise<string> {
    const response = await this.send('PUT', href, {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' },
      body: ics,
    });
    return response.headers.get('ETag') ?? '';
  }

  /**
   * Deletes an object, only if nobody changed it since it was loaded (If-Match); otherwise throws a 412 CalDavError.
   * One already gone counts as deleted.
   */
  async deleteObject({ href, etag }: StoredObject): Promise<void> {
    try {
      await this.send('DELETE', href, { headers: { 'If-Match': etag } });
    } catch (error) {
      if (!(error instanceof CalDavError && error.status === 404)) throw error;
    }
  }

  /** The backend's settings. Not CalDAV, but it needs the same credentials as every /proxy request. */
  async serverConfig(): Promise<ServerConfig> {
    if (this.transport.kind === 'direct') return NO_FEEDS; // no ToDoDAV backend, so no feeds
    const response = await fetch(`${this.transport.origin}/api/config`, { headers: { Authorization: this.authorization } });
    if (!response.ok) throw new CalDavError(response.status, `The server answered ${response.status}.`);
    return (await response.json()) as ServerConfig;
  }

  /** Server href (e.g. /juan/tasks/) -> path under the CalDAV root (juan/tasks/), as /proxy and /feed take it. */
  relativePath(href: string): string {
    // A regex rather than URL, whose React Native version is incomplete.
    const path = href.replace(/^https?:\/\/[^/]+/, '');
    return path.startsWith(this.basePath) ? path.slice(this.basePath.length) : path.replace(/^\//, '');
  }

  /** Every object of one kind in a calendar (matching `filter`, CalDAV filter elements), with its ETag and iCalendar text. */
  private async query(
    calendarHref: string,
    component: Component,
    filter = '',
  ): Promise<{ href: string; etag: string; data: string }[]> {
    const response = await this.send('REPORT', calendarHref, {
      headers: { Depth: '1', 'Content-Type': XML },
      body:
        '<?xml version="1.0" encoding="utf-8"?>' +
        `<c:calendar-query xmlns:d="${DAV}" xmlns:c="${CALDAV}">` +
        '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
        `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="${component}">${filter}</c:comp-filter></c:comp-filter></c:filter>` +
        '</c:calendar-query>',
    });
    return parseMultistatus(await response.text()).flatMap((item) => {
      const data = prop(item, CALDAV, 'calendar-data')?.textContent;
      const etag = prop(item, DAV, 'getetag')?.textContent?.trim();
      return data && etag ? [{ href: item.href, etag, data }] : [];
    });
  }

  private async propfind(href: string | null, depth: 0 | 1, props: string): Promise<DavResponse[]> {
    const response = await this.send('PROPFIND', href, {
      headers: { Depth: String(depth), 'Content-Type': XML },
      body:
        '<?xml version="1.0" encoding="utf-8"?>' +
        `<d:propfind xmlns:d="${DAV}" xmlns:c="${CALDAV}" xmlns:a="${APPLE}"><d:prop>${props}</d:prop></d:propfind>`,
    });
    return parseMultistatus(await response.text());
  }

  /**
   * Server href (e.g. /juan/tasks/) -> request URL: the proxy URL (/proxy/juan/tasks/), or the same path on the
   * CalDAV server. `null` is the CalDAV root.
   */
  private url(href: string | null): string {
    const { transport } = this;
    if (transport.kind === 'proxy') {
      return href === null ? `${transport.origin}/proxy/` : `${transport.origin}/proxy/${this.relativePath(href)}`;
    }
    if (href === null) return transport.url;
    if (/^https?:\/\//.test(href)) return href;
    return `${transport.url.match(/^https?:\/\/[^/]+/)?.[0] ?? ''}${href.startsWith('/') ? href : `/${href}`}`;
  }

  private async send(
    method: string,
    href: string | null,
    init: { headers?: Record<string, string>; body?: string },
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(this.url(href), {
        method,
        headers: { Authorization: this.authorization, ...init.headers },
        body: init.body,
      });
    } catch {
      throw new CalDavError(0, `Could not reach the ${this.transport.kind === 'proxy' ? 'ToDoDAV' : 'CalDAV'} server.`);
    }

    if (response.ok) return response;
    if (response.status === 401) throw new CalDavError(401, 'Wrong username or password.');
    if (response.status === 412) {
      throw new CalDavError(412, 'This was changed somewhere else. The list has been reloaded, try again.');
    }
    if (response.status === 403) {
      const body = await response.json().catch(() => null);
      if (body?.error === 'https_required') throw new CalDavError(403, 'This server only works over HTTPS.');
    }
    throw new CalDavError(response.status, `The CalDAV server answered ${response.status} ${response.statusText}.`.trim());
  }
}

/** Whether the response is a calendar that takes this kind of object. */
function supports(response: DavResponse, component: Component): boolean {
  const resourceType = prop(response, DAV, 'resourcetype');
  if (!resourceType?.getElementsByTagNameNS(CALDAV, 'calendar')[0]) return false;
  const components = prop(response, CALDAV, 'supported-calendar-component-set');
  // No component set means the calendar accepts everything.
  if (!components) return true;
  return Array.from(components.getElementsByTagNameNS(CALDAV, 'comp')).some(
    (comp) => comp.getAttribute('name')?.toUpperCase() === component,
  );
}

const escapeXml = (text: string) =>
  text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

function lastSegment(href: string): string {
  const segment = href.replace(/\/$/, '').split('/').pop() ?? href;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
