import ICAL from 'ical.js';
import type { LocalDate } from '../api/tasks.ts';

export type DueTone = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** "09:30" in the user's locale: "9:30 AM", "9:30"... */
export function formatTime(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Todoist-style due label ("Today", "Tomorrow", "Friday", "3 Oct") and its color tone. */
export function describeDue(due: LocalDate, now = new Date()): { label: string; tone: DueTone } {
  const day = new Date(`${due.date}T00:00`);
  const days = Math.round((day.getTime() - startOfDay(now).getTime()) / DAY_MS);
  const time = due.time ? ` ${formatTime(due.time)}` : '';

  let label: string;
  if (days === 0) label = 'Today';
  else if (days === 1) label = 'Tomorrow';
  else if (days === -1) label = 'Yesterday';
  else if (days > 1 && days < 7) label = day.toLocaleDateString(undefined, { weekday: 'long' });
  else {
    const sameYear = day.getFullYear() === now.getFullYear();
    label = day.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
  }

  const passedToday = days === 0 && due.time !== undefined && new Date(`${due.date}T${due.time}`) < now;
  const tone: DueTone =
    days < 0 || passedToday ? 'overdue' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? 'week' : 'later';
  return { label: label + time, tone };
}

/** A journal day heading: "Today", "Yesterday", "Tomorrow", else "Sunday, 28 Sep" (with the year if not this one). */
export function describeDay(date: string, now = new Date()): string {
  const day = new Date(`${date}T00:00`);
  const days = Math.round((day.getTime() - startOfDay(now).getTime()) / DAY_MS);
  if (days === 0) return 'Today';
  if (days === -1) return 'Yesterday';
  if (days === 1) return 'Tomorrow';
  const sameYear = day.getFullYear() === now.getFullYear();
  return day.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

// The sentence is English, so its words are too (a localized weekday would read "Every viernes").
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const UNITS: Record<string, string> = {
  YEARLY: 'year',
  MONTHLY: 'month',
  WEEKLY: 'week',
  DAILY: 'day',
  HOURLY: 'hour',
  MINUTELY: 'minute',
  SECONDLY: 'second',
};
const listOf = (items: string[]) => new Intl.ListFormat('en', { type: 'conjunction' }).format(items);

/** "2nd Tuesday", "last Friday": a BYDAY value such as 2TU or -1FR, or BYDAY=TU with BYSETPOS=2. */
function nthWeekday(byDay: string, setPos?: number): string | undefined {
  const match = /^([+-]?\d{1,2})?([A-Z]{2})$/.exec(byDay);
  const weekday = match ? WEEKDAY_CODES.indexOf(match[2]!) : -1;
  const nth = match?.[1] !== undefined ? Number(match[1]) : setPos;
  if (weekday < 0 || nth === undefined || nth === 0 || nth < -1) return undefined;
  return `${nth === -1 ? 'last' : ordinal(nth)} ${WEEKDAY_NAMES[weekday]}`;
}

/**
 * A repeat rule in words: "Every weekday", "Every other Friday", "Every month on the 13th", "Every year on
 * March 31, 5 times". `anchor` is the date it counts from (DTSTART, or else DUE), which fills in what the rule
 * leaves implicit. Rules too intricate to put in words (from other apps) say so.
 */
export function describeRepeat(rrule: string, anchor?: LocalDate): string {
  let recur: ICAL.Recur;
  try {
    recur = ICAL.Recur.fromString(rrule);
  } catch {
    return 'Repeats';
  }
  const unit = UNITS[recur.freq];
  if (!unit) return 'Repeats';

  const n = recur.interval || 1;
  const every = n === 1 ? `Every ${unit}` : n === 2 ? `Every other ${unit}` : `Every ${n} ${unit}s`;
  const { BYDAY: byDay = [], BYMONTHDAY: byMonthDay = [], BYMONTH: byMonth = [], BYSETPOS: bySetPos = [] } = recur.parts;
  const used = Object.entries(recur.parts)
    .filter(([, values]) => Array.isArray(values) && values.length > 0)
    .map(([name]) => name);
  const only = (...names: string[]) => used.every((name) => names.includes(name));
  const day = anchor && new Date(`${anchor.date}T00:00`);
  const plainDays = byDay.every((code) => WEEKDAY_CODES.includes(code));
  const isWorkweek = byDay.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((code) => byDay.includes(code));

  let text: string | undefined;
  switch (recur.freq) {
    case 'DAILY':
      if (only()) text = every;
      else if (only('BYDAY') && n === 1 && isWorkweek) text = 'Every weekday';
      break;
    case 'WEEKLY': {
      if (!only('BYDAY') || !plainDays) break;
      const codes = byDay.length > 0 ? byDay : day ? [WEEKDAY_CODES[day.getDay()]!] : [];
      const names = WEEKDAY_CODES.filter((code) => codes.includes(code)).map((code) => WEEKDAY_NAMES[WEEKDAY_CODES.indexOf(code)]!);
      if (names.length === 0) text = every;
      else if (n === 1) text = isWorkweek ? 'Every weekday' : `Every ${listOf(names)}`;
      else if (n === 2 && names.length === 1) text = `Every other ${names[0]}`;
      else text = `${every} on ${listOf(names)}`;
      break;
    }
    case 'MONTHLY':
      if (only()) text = day ? `${every} on the ${ordinal(day.getDate())}` : every;
      else if (only('BYMONTHDAY') && byMonthDay.every((d) => d > 0 || d === -1)) {
        text = `${every} on the ${listOf(byMonthDay.map((d) => (d === -1 ? 'last day' : ordinal(d))))}`;
      } else if (only('BYDAY', 'BYSETPOS') && byDay.length === 1 && bySetPos.length <= 1) {
        const nth = nthWeekday(byDay[0]!, bySetPos[0]);
        if (nth) text = `${every} on the ${nth}`;
      }
      break;
    case 'YEARLY': {
      const month = byMonth.length === 1 ? byMonth[0]! - 1 : day?.getMonth();
      if (only() || (only('BYMONTH', 'BYMONTHDAY') && byMonth.length <= 1 && byMonthDay.length <= 1)) {
        const date = byMonthDay[0] ?? day?.getDate();
        text = month !== undefined && date !== undefined && date > 0 ? `${every} on ${MONTH_NAMES[month]} ${date}` : every;
      } else if (only('BYMONTH', 'BYDAY', 'BYSETPOS') && byMonth.length === 1 && byDay.length === 1 && bySetPos.length <= 1) {
        const nth = nthWeekday(byDay[0]!, bySetPos[0]);
        if (nth && month !== undefined) text = `${every} on the ${nth} of ${MONTH_NAMES[month]}`;
      }
      break;
    }
    default:
      if (only()) text = every;
  }
  text ??= `${every}, custom rule`;

  if (recur.count) text += recur.count === 1 ? ', once' : `, ${recur.count} times`;
  if (recur.until) {
    const until = recur.until.isDate
      ? new Date(recur.until.year, recur.until.month - 1, recur.until.day)
      : recur.until.toJSDate();
    text += `, until ${until.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return text;
}
