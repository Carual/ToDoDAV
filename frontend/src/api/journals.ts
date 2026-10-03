import ICAL from 'ical.js';
import {
  categoriesOf,
  dropOverridesIfSingle,
  newCalendarObject,
  newUid,
  parseCalendar,
  sameDate,
  setCategories,
  setDate,
  setLocation,
  setText,
  toDate,
  toLocalDate,
  touch,
  type LocalDate,
} from './ical.ts';

/** RFC 5545's statuses for a VJOURNAL; '' is none. */
export type JournalStatus = '' | 'DRAFT' | 'FINAL' | 'CANCELLED';

/** A journal entry (VJOURNAL with DTSTART) or, without a date, a note (as jtx Board calls them). */
export interface Journal {
  /** Path of the .ics file on the CalDAV server. */
  href: string;
  etag: string;
  /** The full iCalendar text, kept so edits only touch the fields ToDoDAV knows about. */
  ics: string;
  uid: string;
  summary: string;
  description: string;
  start?: LocalDate;
  status: JournalStatus;
  categories: string[];
  location?: string;
  url?: string;
  /** The RRULE value when the entry repeats (written by another app; the modal only shows it). */
  recurrence?: string;
  created?: Date;
  lastModified?: Date;
}

/** The fields the journal modal can change. */
export interface JournalEdits {
  summary: string;
  description: string;
  start?: LocalDate;
  status: JournalStatus;
  categories: string[];
  location: string;
}

const STATUSES: ReadonlySet<string> = new Set(['DRAFT', 'FINAL', 'CANCELLED']);

/** A VJOURNAL may have several DESCRIPTIONs (RFC 5545 allows it); they show as one text, as in the feed. */
function descriptionOf(vjournal: ICAL.Component): string {
  return vjournal
    .getAllProperties('description')
    .map((property) => String(property.getFirstValue() ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

export function parseJournal(href: string, etag: string, ics: string): Journal {
  const { main: vjournal } = parseCalendar(ics, 'vjournal');
  const text = (name: string) => {
    const value = vjournal.getFirstPropertyValue(name);
    return value == null ? undefined : String(value);
  };
  const status = text('status')?.toUpperCase() ?? '';
  const rrule = vjournal.getFirstPropertyValue('rrule');

  return {
    href,
    etag,
    ics,
    uid: text('uid') ?? href,
    summary: text('summary') ?? '',
    description: descriptionOf(vjournal),
    start: toLocalDate(vjournal.getFirstPropertyValue('dtstart')),
    status: STATUSES.has(status) ? (status as JournalStatus) : '',
    categories: categoriesOf(vjournal),
    location: text('location'),
    url: text('url'),
    recurrence: rrule instanceof ICAL.Recur ? rrule.toString() : undefined,
    created: toDate(vjournal.getFirstPropertyValue('created')),
    lastModified: toDate(vjournal.getFirstPropertyValue('last-modified')),
  };
}

/** Writes the editable fields into a VJOURNAL. `previous` is the entry as loaded (absent for a new one). */
function writeEdits(vjournal: ICAL.Component, edits: JournalEdits, previous?: Journal) {
  setText(vjournal, 'summary', edits.summary.trim());
  // Rewritten only when edited: several DESCRIPTIONs from another app stay as they were until then.
  const description = edits.description.trim();
  if (description !== (previous?.description ?? '')) {
    vjournal.removeAllProperties('description');
    setText(vjournal, 'description', description);
  }

  // Only rewrite the date when it changed, so an untouched one keeps its original time zone.
  if (!sameDate(edits.start, previous?.start)) setDate(vjournal, 'dtstart', edits.start);
  // A repeat counts from DTSTART; without one, it has nothing to count from.
  if (!edits.start) for (const name of ['rrule', 'rdate', 'exdate']) vjournal.removeAllProperties(name);

  if (edits.status !== (previous?.status ?? '')) setText(vjournal, 'status', edits.status);
  setCategories(vjournal, edits.categories);
  setLocation(vjournal, edits.location.trim(), previous?.location);
}

/** Returns the entry's iCalendar text with the edits applied; every other property is kept as it was. */
export function applyJournalEdits(journal: Journal, edits: JournalEdits): string {
  const { vcalendar, main: vjournal } = parseCalendar(journal.ics, 'vjournal');
  writeEdits(vjournal, edits, journal);
  dropOverridesIfSingle(vcalendar, vjournal);
  touch(vjournal);
  return vcalendar.toString();
}

/** iCalendar text for a brand-new entry, and the UID it was given. */
export function newJournalIcs(edits: JournalEdits): { uid: string; ics: string } {
  const uid = newUid();
  const { vcalendar, component } = newCalendarObject('vjournal', uid);
  writeEdits(component, edits);
  return { uid, ics: vcalendar.toString() };
}
