import type ICAL from 'ical.js';
import { ordinal } from '../lib/format.ts';
import type { LocalDate } from './tasks.ts';

/** A Todoist date as a task has it: the (next) due date, and an RRULE value when it repeats. */
export interface TodoistDate {
  due: LocalDate;
  recurrence?: string;
}

type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Todoist writes dates in the language of DATE_LANG. English and Spanish words are understood; anything else
// is kept as text in the description.
const words = (entries: Record<string, number | string>) => new Map(Object.entries(entries));

const WEEKDAYS = words({
  sunday: 0, sun: 0, domingo: 0,
  monday: 1, mon: 1, lunes: 1,
  tuesday: 2, tue: 2, tues: 2, martes: 2,
  wednesday: 3, wed: 3, miércoles: 3, miercoles: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, jueves: 4,
  friday: 5, fri: 5, viernes: 5,
  saturday: 6, sat: 6, sábado: 6, sabado: 6,
}) as Map<string, number>;

const MONTHS = words({
  jan: 0, january: 0, ene: 0, enero: 0,
  feb: 1, february: 1, febrero: 1,
  mar: 2, march: 2, marzo: 2,
  apr: 3, april: 3, abr: 3, abril: 3,
  may: 4, mayo: 4,
  jun: 5, june: 5, junio: 5,
  jul: 6, july: 6, julio: 6,
  aug: 7, august: 7, ago: 7, agosto: 7,
  sep: 8, sept: 8, september: 8, septiembre: 8, setiembre: 8,
  oct: 9, october: 9, octubre: 9,
  nov: 10, november: 10, noviembre: 10,
  dec: 11, december: 11, dic: 11, diciembre: 11,
}) as Map<string, number>;

const UNITS = words({
  day: 'DAILY', days: 'DAILY', día: 'DAILY', dia: 'DAILY', días: 'DAILY', dias: 'DAILY',
  week: 'WEEKLY', weeks: 'WEEKLY', semana: 'WEEKLY', semanas: 'WEEKLY',
  month: 'MONTHLY', months: 'MONTHLY', mes: 'MONTHLY', meses: 'MONTHLY',
  year: 'YEARLY', years: 'YEARLY', año: 'YEARLY', años: 'YEARLY',
}) as Map<string, Frequency>;

const RELATIVE_DAYS = words({ today: 0, hoy: 0, tomorrow: 1, tmrw: 1, mañana: 1, manana: 1, yesterday: -1, ayer: -1 }) as Map<
  string,
  number
>;

const ORDINALS = words({
  first: 1, '1st': 1, primer: 1, primero: 1,
  second: 2, '2nd': 2, segundo: 2,
  third: 3, '3rd': 3, tercer: 3, tercero: 3,
  fourth: 4, '4th': 4, cuarto: 4,
  last: -1, último: -1, ultimo: -1,
}) as Map<string, number>;

const REPEAT = new Set(['every', 'each', 'cada', 'todos', 'todas']);
const WORKDAY = new Set(['weekday', 'weekdays', 'workday', 'workdays', 'laborable', 'laborables']);
const NEXT = new Set(['next', 'próximo', 'proximo', 'próxima', 'proxima']);
const THIS = new Set(['this', 'este', 'esta']);
/** Words that add nothing to the date: "on the 13th", "27 de enero". */
const FILLERS = new Set(['on', 'the', 'of', 'and', 'de', 'del', 'el', 'la', 'los', 'las', 'y', '&']);
/** Clauses this parser cannot honor (an end to the repeat); such dates are left as text. */
const LIMITS = new Set(['ending', 'until', 'for', 'hasta', 'durante']);

const pad = (n: number) => String(n).padStart(2, '0');
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const toLocal = (date: Date, time?: string): LocalDate => ({
  date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
  time,
});

export function addMinutes(value: LocalDate, minutes: number): LocalDate {
  const date = new Date(`${value.date}T${value.time ?? '00:00'}`);
  date.setMinutes(date.getMinutes() + minutes);
  return toLocal(date, `${pad(date.getHours())}:${pad(date.getMinutes())}`);
}

/** The first day from `from` on (included) that passes `test`; four years covers a 29 February. */
function firstDay(from: Date, test: (date: Date) => boolean): Date | undefined {
  for (let i = 0; i < 4 * 366; i++) {
    const date = addDays(from, i);
    if (test(date)) return date;
  }
  return undefined;
}

/** Only real dates: 30 February is refused rather than rolled over into March. */
function makeDate(year: number, month: number, day: number): Date | undefined {
  const date = new Date(year, month, day);
  return date.getMonth() === month && date.getDate() === day ? date : undefined;
}

function dayOfMonth(word: string | undefined): number | undefined {
  const match = word && /^(\d{1,2})(st|nd|rd|th|º|°|ª)?$/.exec(word);
  const day = match ? Number(match[1]) : 0;
  return day >= 1 && day <= 31 ? day : undefined;
}

/** "Mar 31", "31 March", "31 de marzo de 2025" (fillers already gone). */
function monthDay(parts: string[]): { month: number; day: number; year?: number } | undefined {
  const [a, b, year] = parts;
  if (parts.length < 2 || parts.length > 3 || !a || !b) return undefined;
  let month = MONTHS.get(a);
  let day = dayOfMonth(b);
  if (month === undefined || day === undefined) {
    month = MONTHS.get(b);
    day = dayOfMonth(a);
  }
  if (month === undefined || day === undefined) return undefined;
  if (year === undefined) return { month, day };
  return /^\d{4}$/.test(year) ? { month, day, year: Number(year) } : undefined;
}

const TIME_PATTERNS = [
  /(?:\bat|\ba las?|@)\s*(?<h>\d{1,2})(?::(?<m>\d{2}))?\s*(?<ap>[ap]m)?(?![\w:])/,
  /\b(?<h>\d{1,2}):(?<m>\d{2})\s*(?<ap>[ap]m)?(?![\w:])/,
  /\b(?<h>\d{1,2})\s*(?<ap>[ap]m)(?!\w)/,
];

/**
 * Takes the time out of the text ("at 11:00", "@ 13:00", "5pm", "a las 9"). A bare number is not a time,
 * since "every 2 days" and "every 13th" use numbers too. `null` means a time that cannot exist (25:00).
 */
function takeTime(text: string): { rest: string; time?: string } | null {
  for (const pattern of TIME_PATTERNS) {
    const match = pattern.exec(text);
    if (!match?.groups) continue;
    let hours = Number(match.groups.h);
    const minutes = Number(match.groups.m ?? 0);
    const suffix = match.groups.ap;
    if (suffix && (hours < 1 || hours > 12)) return null;
    if (suffix === 'pm' && hours < 12) hours += 12;
    if (suffix === 'am' && hours === 12) hours = 0;
    if (hours > 23 || minutes > 59) return null;
    const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
    return { rest, time: `${pad(hours)}:${pad(minutes)}` };
  }
  return { rest: text };
}

/** A single day: "today", "friday", "next week", "in 3 days", "2025-03-31", "Mar 31 2025". */
function parseDay(parts: string[], today: Date): Date | undefined {
  const [first = '', second = '', third = ''] = parts;
  if (parts.length === 1) {
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(first);
    if (iso) return makeDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const relative = RELATIVE_DAYS.get(first);
    if (relative !== undefined) return addDays(today, relative);
    const weekday = WEEKDAYS.get(first);
    if (weekday !== undefined) return firstDay(today, (d) => d.getDay() === weekday);
  }
  if (parts.length === 2) {
    const weekday = WEEKDAYS.get(second);
    if (weekday !== undefined && NEXT.has(first)) return firstDay(addDays(today, 1), (d) => d.getDay() === weekday);
    if (weekday !== undefined && THIS.has(first)) return firstDay(today, (d) => d.getDay() === weekday);
    // Todoist's "next week" is the coming Monday.
    if (NEXT.has(first) && UNITS.get(second) === 'WEEKLY') return firstDay(addDays(today, 1), (d) => d.getDay() === 1);
  }
  if (parts.length === 3 && (first === 'in' || first === 'en') && /^\d+$/.test(second)) {
    const n = Number(second);
    const unit = UNITS.get(third);
    if (unit === 'DAILY') return addDays(today, n);
    if (unit === 'WEEKLY') return addDays(today, 7 * n);
    if (unit === 'MONTHLY') return new Date(today.getFullYear(), today.getMonth() + n, today.getDate());
    if (unit === 'YEARLY') return new Date(today.getFullYear() + n, today.getMonth(), today.getDate());
  }
  const md = monthDay(parts);
  if (md?.year !== undefined) return makeDate(md.year, md.month, md.day);
  // Without a year, the next time that day comes round, as Todoist does.
  if (md) return firstDay(today, (d) => d.getMonth() === md.month && d.getDate() === md.day);
  return undefined;
}

/** A repeat, from the words after "every": its RRULE and the first occurrence from today on. */
function parseRepeat(parts: string[], today: Date): { first: Date; recurrence: string } | undefined {
  let interval = 1;
  let rest = parts;
  if (['other', 'otro', 'otra'].includes(rest[0] ?? '')) {
    interval = 2;
    rest = rest.slice(1);
  } else if (rest.length >= 2 && /^\d+$/.test(rest[0]!)) {
    interval = Number(rest[0]);
    rest = rest.slice(1);
  }
  if (interval < 1 || rest.length === 0) return undefined;
  const rule = (freq: Frequency, byParts = '') => `FREQ=${freq}${interval > 1 ? `;INTERVAL=${interval}` : ''}${byParts}`;
  const [word = '', next] = rest;

  // every day / week / month / year: from today, like Todoist.
  const unit = rest.length === 1 ? UNITS.get(word) : undefined;
  if (unit) return { first: today, recurrence: rule(unit) };

  // every weekday (Monday to Friday)
  if (rest.some((w) => WORKDAY.has(w)) && rest.every((w) => WORKDAY.has(w) || UNITS.get(w) === 'DAILY')) {
    const first = firstDay(today, (d) => d.getDay() >= 1 && d.getDay() <= 5)!;
    return { first, recurrence: rule('WEEKLY', ';BYDAY=MO,TU,WE,TH,FR') };
  }

  // every friday / every mon, fri / every other friday
  const days = rest.map((w) => WEEKDAYS.get(w));
  if (days.every((d): d is number => d !== undefined)) {
    const unique = [...new Set(days)].sort();
    const first = firstDay(today, (d) => unique.includes(d.getDay()))!;
    return { first, recurrence: rule('WEEKLY', `;BYDAY=${unique.map((d) => WEEKDAY_CODES[d]).join(',')}`) };
  }
  if (interval !== 1) return undefined;

  // every 13th: monthly, on the due date's day
  const monthly = rest.length === 1 ? dayOfMonth(word) : undefined;
  if (monthly !== undefined) {
    const first = firstDay(today, (d) => d.getDate() === monthly);
    return first && { first, recurrence: rule('MONTHLY') };
  }

  // every 3rd friday / every last friday
  const nth = rest.length === 2 ? ORDINALS.get(word) : undefined;
  const weekday = next === undefined ? undefined : WEEKDAYS.get(next);
  if (nth !== undefined && weekday !== undefined) {
    const inMonth = (d: Date) => (nth > 0 ? Math.ceil(d.getDate() / 7) === nth : addDays(d, 7).getMonth() !== d.getMonth());
    const first = firstDay(today, (d) => d.getDay() === weekday && inMonth(d))!;
    return { first, recurrence: rule('MONTHLY', `;BYDAY=${nth}${WEEKDAY_CODES[weekday]}`) };
  }

  // every Mar 31: yearly, on the due date's day
  const yearly = monthDay(rest);
  if (yearly && yearly.year === undefined) {
    const first = firstDay(today, (d) => d.getMonth() === yearly.month && d.getDate() === yearly.day);
    return first && { first, recurrence: rule('YEARLY') };
  }
  return undefined;
}

/**
 * Reads a Todoist DATE or DEADLINE cell, which is free text ("today at 11:00", "every Friday",
 * "every month @ 13:00", "2025-03-31"). Returns undefined for text it does not understand.
 */
export function parseTodoistDate(text: string, now = new Date()): TodoistDate | undefined {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/\b([ap])\.\s?m\.?/g, '$1m')
    .replace(/(\d{4}-\d{2}-\d{2})t/, '$1 ');
  const timed = takeTime(normalized);
  if (!timed) return undefined;
  const { rest, time } = timed;

  const all = rest.split(/[\s,;.]+/).filter((w) => w && !FILLERS.has(w));
  // Todoist's own export drops "starting ..." too; the repeat then runs from today.
  const starting = all.findIndex((w) => w === 'starting' || w === 'desde');
  const parts = starting < 0 ? all : all.slice(0, starting);
  if (parts.some((w) => LIMITS.has(w))) return undefined;

  const today = startOfDay(now);
  if (REPEAT.has(parts[0] ?? '')) {
    const repeat = parseRepeat(parts.slice(1), today);
    return repeat && { due: toLocal(repeat.first, time), recurrence: repeat.recurrence };
  }
  // A time alone ("at 11:00") is today, as in Todoist.
  const day = parts.length === 0 ? (time ? today : undefined) : parseDay(parts, today);
  return day && { due: toLocal(day, time) };
}

/** A repeat in Todoist's words ("every Friday", "every 13th"), or undefined when Todoist has none for it. */
function describeRepeat(recur: ICAL.Recur, due: LocalDate): string | undefined {
  // Todoist can end a repeat, but its wording for that is not documented for imports.
  if (recur.count || recur.until) return undefined;
  const used = Object.entries(recur.parts)
    .filter(([, values]) => Array.isArray(values) && values.length > 0)
    .map(([name]) => name);
  const only = (...names: string[]) => used.every((name) => names.includes(name));
  const n = recur.interval || 1;
  const day = new Date(`${due.date}T00:00`);

  switch (recur.freq) {
    case 'DAILY':
      return only() ? (n === 1 ? 'every day' : `every ${n} days`) : undefined;
    case 'WEEKLY': {
      if (!only('BYDAY')) return undefined;
      const days = (recur.parts.BYDAY ?? [WEEKDAY_CODES[day.getDay()]!]).map((code) => WEEKDAY_CODES.indexOf(code));
      if (days.some((d) => d < 0)) return undefined;
      const names = days.map((d) => WEEKDAY_NAMES[d]).join(', ');
      if (n === 1) return [1, 2, 3, 4, 5].every((d) => days.includes(d)) && days.length === 5 ? 'every weekday' : `every ${names}`;
      if (n === 2 && days.length === 1) return `every other ${names}`;
      return recur.parts.BYDAY ? undefined : `every ${n} weeks`;
    }
    case 'MONTHLY': {
      if (n > 1) return only() ? `every ${n} months` : undefined;
      if (only()) return `every ${ordinal(day.getDate())}`;
      const monthDays = recur.parts.BYMONTHDAY ?? [];
      if (only('BYMONTHDAY') && monthDays.length === 1 && monthDays[0]! > 0) return `every ${ordinal(monthDays[0]!)}`;
      const byDay = recur.parts.BYDAY ?? [];
      const nth = only('BYDAY') && byDay.length === 1 ? /^\+?([1-4])([A-Z]{2})$/.exec(byDay[0]!) : null;
      const weekday = nth ? WEEKDAY_CODES.indexOf(nth[2]!) : -1;
      return nth && weekday >= 0 ? `every ${ordinal(Number(nth[1]))} ${WEEKDAY_NAMES[weekday]}` : undefined;
    }
    case 'YEARLY':
      if (!only()) return undefined;
      return n === 1 ? `every ${MONTH_NAMES[day.getMonth()]} ${day.getDate()}` : `every ${n} years`;
    default:
      return undefined;
  }
}

/**
 * A DATE cell Todoist can read. Plain dates are ISO (as in Todoist's own template); repeats are in words, and
 * like Todoist's export they leave out when the repeat started. `repeatLost` says a repeat had no wording.
 */
export function formatTodoistDate(due: LocalDate, recur?: ICAL.Recur): { text: string; repeatLost: boolean } {
  const at = due.time ? ` at ${due.time}` : '';
  const every = recur && describeRepeat(recur, due);
  if (every) return { text: every + at, repeatLost: false };
  return { text: due.date + at, repeatLost: recur !== undefined };
}
