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
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
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
 * Talks CalDAV through the ToDoDAV backend: every request goes to /proxy/... and the backend
 * forwards it to the CalDAV server configured there.
 */
export class CalDavClient {
  readonly username: string;
  private readonly authorization: string;
  private readonly origin: string;
  /** Path of the CalDAV root on the server. Hrefs in responses start with it; /proxy/ maps onto it. */
  private basePath = '/';

  /** `origin` is only needed outside the browser; in the app requests are same-origin. */
  constructor(credentials: Credentials, origin = '') {
    this.username = credentials.username;
    this.authorization = basicAuth(credentials);
    this.origin = origin;
  }

  /** Finds the user's task lists. It is also the login check: wrong credentials throw a 401 CalDavError. */
  async discoverCalendars(): Promise<Calendar[]> {
    const [root] = await this.propfind(null, 0, '<d:current-user-principal/>');
    if (!root) throw new CalDavError(502, 'The CalDAV server gave an empty answer.');
    // The href of /proxy/ itself tells which server path the proxy maps to.
    this.basePath = root.href.endsWith('/') ? root.href : `${root.href}/`;

    const principal = hrefInside(prop(root, DAV, 'current-user-principal'));
    if (!principal) throw new CalDavError(502, 'The CalDAV server did not say who you are.');

    const [principalResponse] = await this.propfind(principal, 0, '<c:calendar-home-set/>');
    const home = (principalResponse && hrefInside(prop(principalResponse, CALDAV, 'calendar-home-set'))) ?? principal;

    const responses = await this.propfind(
      home,
      1,
      '<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><a:calendar-color/>',
    );
    return responses.filter(isTaskList).map((response) => ({
      href: response.href,
      name: prop(response, DAV, 'displayname')?.textContent?.trim() || lastSegment(response.href),
      color: prop(response, APPLE, 'calendar-color')?.textContent?.trim().slice(0, 7) || undefined,
    }));
  }

  /** All tasks (open and completed) of one list. */
  async listTasks(calendarHref: string): Promise<Task[]> {
    const response = await this.send('REPORT', calendarHref, {
      headers: { Depth: '1', 'Content-Type': XML },
      body:
        '<?xml version="1.0" encoding="utf-8"?>' +
        `<c:calendar-query xmlns:d="${DAV}" xmlns:c="${CALDAV}">` +
        '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
        '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter>' +
        '</c:calendar-query>',
    });
    const tasks: Task[] = [];
    for (const item of parseMultistatus(await response.text())) {
      const data = prop(item, CALDAV, 'calendar-data')?.textContent;
      const etag = prop(item, DAV, 'getetag')?.textContent?.trim();
      if (!data || !etag) continue;
      try {
        tasks.push(parseTask(item.href, etag, data));
      } catch {
        // Skip objects that are not valid tasks instead of failing the whole list.
      }
    }
    return tasks;
  }

  /**
   * Saves a task's new iCalendar text. Only succeeds if nobody changed it since it was loaded (If-Match);
   * otherwise throws a 412 CalDavError. Returns the saved task.
   */
  async saveTask(task: Task, ics: string): Promise<Task> {
    const response = await this.send('PUT', task.href, {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-Match': task.etag },
      body: ics,
    });
    // Some servers do not return the new ETag; an empty one makes the next save reload first.
    return parseTask(task.href, response.headers.get('ETag') ?? '', ics);
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

  /** Server href (e.g. /juan/tasks/) -> proxy URL (/proxy/juan/tasks/). `null` is the proxy root. */
  private url(href: string | null): string {
    if (href === null) return `${this.origin}/proxy/`;
    const path = /^https?:\/\//.test(href) ? new URL(href).pathname : href;
    const relative = path.startsWith(this.basePath) ? path.slice(this.basePath.length) : path.replace(/^\//, '');
    return `${this.origin}/proxy/${relative}`;
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
      throw new CalDavError(0, 'Could not reach the ToDoDAV server.');
    }

    if (response.ok) return response;
    if (response.status === 401) throw new CalDavError(401, 'Wrong username or password.');
    if (response.status === 412) {
      throw new CalDavError(412, 'This task was changed somewhere else. The list has been reloaded, try again.');
    }
    if (response.status === 403) {
      const body = await response.json().catch(() => null);
      if (body?.error === 'https_required') throw new CalDavError(403, 'This server only works over HTTPS.');
    }
    throw new CalDavError(response.status, `The CalDAV server answered ${response.status} ${response.statusText}.`.trim());
  }
}

function isTaskList(response: DavResponse): boolean {
  const resourceType = prop(response, DAV, 'resourcetype');
  if (!resourceType?.getElementsByTagNameNS(CALDAV, 'calendar')[0]) return false;
  const components = prop(response, CALDAV, 'supported-calendar-component-set');
  // No component set means the calendar accepts everything, tasks included.
  if (!components) return true;
  return Array.from(components.getElementsByTagNameNS(CALDAV, 'comp')).some(
    (comp) => comp.getAttribute('name')?.toUpperCase() === 'VTODO',
  );
}

function lastSegment(href: string): string {
  const segment = href.replace(/\/$/, '').split('/').pop() ?? href;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
