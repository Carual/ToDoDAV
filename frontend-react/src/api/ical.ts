import ICAL from 'ical.js';

// What tasks (VTODO) and journal entries (VJOURNAL) share: reading a calendar object, dates, and the
// bookkeeping every edit does.

/** A date in local time: `date` is yyyy-mm-dd, `time` (optional) is HH:mm. */
export interface LocalDate {
  date: string;
  time?: string;
}

/**
 * The calendar object and its main component of this kind. A repeating one can share its file with overrides of
 * single occurrences (RECURRENCE-ID), in any order; the main one is the one without.
 */
export function parseCalendar(ics: string, kind: 'vtodo' | 'vjournal') {
  const vcalendar = new ICAL.Component(ICAL.parse(ics));
  // Register the time zones shipped in the file so TZID times convert correctly.
  for (const vtimezone of vcalendar.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(vtimezone);
    } catch {
      // A broken VTIMEZONE only makes times fall back to floating local time.
    }
  }
  const components = vcalendar.getAllSubcomponents(kind);
  const main = components.find((component) => !component.hasProperty('recurrence-id')) ?? components[0];
  if (!main) throw new Error(`No ${kind.toUpperCase()} in calendar object`);
  return { vcalendar, main };
}

export const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalDate(value: unknown): LocalDate | undefined {
  if (!(value instanceof ICAL.Time)) return undefined;
  if (value.isDate) return { date: `${value.year}-${pad(value.month)}-${pad(value.day)}` };
  const d = value.toJSDate();
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export function toDate(value: unknown): Date | undefined {
  return value instanceof ICAL.Time ? value.toJSDate() : undefined;
}

export const nowUtc = () => ICAL.Time.fromJSDate(new Date(), true);

/** Marks the component as changed, as RFC 5545 expects from every client that edits it. */
export function touch(component: ICAL.Component) {
  component.updatePropertyWithValue('dtstamp', nowUtc());
  component.updatePropertyWithValue('last-modified', nowUtc());
  component.updatePropertyWithValue('sequence', Number(component.getFirstPropertyValue('sequence') ?? 0) + 1);
}

export function setText(component: ICAL.Component, name: string, value: string) {
  if (value) component.updatePropertyWithValue(name, value);
  else component.removeAllProperties(name);
}

export const sameDate = (a?: LocalDate, b?: LocalDate) => a?.date === b?.date && a?.time === b?.time;

/** All-day dates become DATE values; timed ones become UTC DATE-TIME values. */
export function setDate(component: ICAL.Component, name: string, value: LocalDate | undefined) {
  component.removeAllProperties(name);
  if (!value) return;
  component.addPropertyWithValue(
    name,
    value.time ? ICAL.Time.fromJSDate(new Date(`${value.date}T${value.time}`), true) : ICAL.Time.fromDateString(value.date),
  );
}

export function categoriesOf(component: ICAL.Component): string[] {
  return component
    .getAllProperties('categories')
    .flatMap((property) => property.getValues().map(String))
    .filter(Boolean);
}

export function setCategories(component: ICAL.Component, categories: string[]) {
  component.removeAllProperties('categories');
  if (categories.length === 0) return;
  const property = new ICAL.Property('categories');
  property.setValues(categories);
  component.addProperty(property);
}

/** Coordinates written by other apps (Apple Reminders, GEO) describe the old text, so they go with it. */
export function setLocation(component: ICAL.Component, location: string, previous: string | undefined) {
  if (location === (previous?.trim() ?? '')) return;
  setText(component, 'location', location);
  component.removeAllProperties('x-apple-structured-location');
  component.removeAllProperties('geo');
}

/** Changed single occurrences (RECURRENCE-ID) mean nothing once the main component no longer repeats. */
export function dropOverridesIfSingle(vcalendar: ICAL.Component, main: ICAL.Component) {
  if (main.hasProperty('rrule') || main.hasProperty('rdate')) return;
  for (const other of vcalendar.getAllSubcomponents(main.name)) {
    if (other !== main && other.hasProperty('recurrence-id')) vcalendar.removeSubcomponent(other);
  }
}

/** A new VCALENDAR holding one new component of this kind, with what every new component carries. */
export function newCalendarObject(kind: 'vtodo' | 'vjournal', uid: string, created?: Date) {
  const vcalendar = new ICAL.Component('vcalendar');
  vcalendar.updatePropertyWithValue('version', '2.0');
  vcalendar.updatePropertyWithValue('prodid', '-//ToDoDAV//EN');
  const component = new ICAL.Component(kind);
  vcalendar.addSubcomponent(component);
  component.updatePropertyWithValue('uid', uid);
  component.updatePropertyWithValue('dtstamp', nowUtc());
  component.updatePropertyWithValue('created', created ? ICAL.Time.fromJSDate(created, true) : nowUtc());
  component.updatePropertyWithValue('last-modified', nowUtc());
  return { vcalendar, component };
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
