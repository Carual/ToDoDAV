import ICAL from 'ical.js';
import type { LocalDate } from './api/tasks.ts';
import { describeRepeat, ordinal } from './format.ts';

// Repeats as the task modal offers them: Google Calendar's choices (every day, every weekday, weekly on the
// date's weekday, monthly on its day or its nth weekday, yearly), plus a custom form for the rest.
//
// Rules are written the way RFC 5545 reads them: what the date already says is left out ("FREQ=MONTHLY" is
// monthly on the date's day), so moving the date moves the repeat along, as in Google Calendar.

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** iCalendar weekday codes, Monday first as the custom form shows them. */
export const WEEK = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const JS_WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WORKWEEK = ['MO', 'TU', 'WE', 'TH', 'FR'];

/** Everything the custom form can express. */
export interface RepeatForm {
  freq: Frequency;
  /** Every how many days, weeks...; 0 while the field is being retyped. */
  interval: number;
  /** WEEKLY only: the weekday codes, in WEEK order. */
  days: string[];
  /** MONTHLY only: on the date's day of the month, on its nth weekday ("2nd Tuesday"), or on its last one. */
  monthly: 'day' | 'nth' | 'last';
  end: 'never' | 'count' | 'until';
  /** Occurrences when `end` is 'count'; 0 while the field is being retyped. */
  count: number;
  /** Last day (yyyy-mm-dd) when `end` is 'until'. */
  until: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (date: LocalDate) => new Date(`${date.date}T00:00`);
const toDateString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const weekdayCode = (d: Date) => JS_WEEKDAYS[d.getDay()]!;
/** Which of its weekday in the month a day is: the 2nd Tuesday is 2. */
const nthInMonth = (d: Date) => Math.ceil(d.getDate() / 7);
const isLastInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getMonth() !== d.getMonth();

export function todayDate(): LocalDate {
  return { date: toDateString(new Date()) };
}

/** Moves a date by whole days, keeping its time. */
export function addDaysTo(date: LocalDate | undefined, days: number): LocalDate | undefined {
  if (!date || days === 0) return date;
  const d = dayOf(date);
  d.setDate(d.getDate() + days);
  return { ...date, date: toDateString(d) };
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((dayOf(to).getTime() - dayOf(from).getTime()) / (24 * 60 * 60 * 1000));
}

function parseRule(rule: string): ICAL.Recur | undefined {
  try {
    return ICAL.Recur.fromString(rule);
  } catch {
    return undefined;
  }
}

/**
 * Same repeat, however it is spelled: part order, defaults, and (with the date it counts from) what the date
 * already says, so "FREQ=WEEKLY;BYDAY=FR" on a Friday is "FREQ=WEEKLY".
 */
export function sameRule(a: string | undefined, b: string | undefined, anchor?: LocalDate): boolean {
  if (a === undefined || b === undefined) return a === b;
  const canonical = (rule: string) => {
    const form = anchor && ruleToForm(rule, anchor);
    return form ? formToRule(form, anchor, true) : (parseRule(rule)?.toString() ?? rule);
  };
  return canonical(a) === canonical(b);
}

/** The custom form a date starts from: every week, on that date's weekday. */
export function defaultForm(anchor: LocalDate, freq: Frequency = 'WEEKLY'): RepeatForm {
  const day = dayOf(anchor);
  const until = new Date(day.getFullYear(), day.getMonth() + 3, day.getDate());
  return {
    freq,
    interval: 1,
    days: [weekdayCode(day)],
    monthly: 'day',
    end: 'never',
    count: 10,
    until: toDateString(until),
  };
}

/**
 * UNTIL has to be the dates' own type (RFC 5545): a date for all-day tasks, a UTC time for timed ones, where
 * the whole last day still counts.
 */
function untilTime(date: string, allDay: boolean): ICAL.Time {
  if (allDay) return ICAL.Time.fromDateString(date);
  return ICAL.Time.fromJSDate(new Date(`${date}T23:59:59`), true);
}

function untilDate(until: ICAL.Time): string {
  if (until.isDate) return `${until.year}-${pad(until.month)}-${pad(until.day)}`;
  return toDateString(until.toJSDate());
}

/** The rule a form describes, counting from `anchor`. */
export function formToRule(form: RepeatForm, anchor: LocalDate, allDay: boolean): string {
  const day = dayOf(anchor);
  const parts = [`FREQ=${form.freq}`];
  if (form.interval > 1) parts.push(`INTERVAL=${form.interval}`);
  if (form.freq === 'WEEKLY') {
    const days = WEEK.filter((code) => form.days.includes(code));
    const implied = days.length === 1 && days[0] === weekdayCode(day);
    if (days.length > 0 && !implied) parts.push(`BYDAY=${days.join(',')}`);
  }
  if (form.freq === 'MONTHLY' && form.monthly !== 'day') {
    // A 5th weekday doesn't come every month; the last one does.
    const nth = form.monthly === 'last' || nthInMonth(day) > 4 ? -1 : nthInMonth(day);
    parts.push(`BYDAY=${nth}${weekdayCode(day)}`);
  }
  if (form.end === 'count' && form.count > 0) parts.push(`COUNT=${form.count}`);
  if (form.end === 'until' && form.until) parts.push(`UNTIL=${untilTime(form.until, allDay).toICALString()}`);
  return parts.join(';');
}

/**
 * The form for a rule, or undefined when the form can't show it exactly (rules from other apps can say far
 * more). The date fills in what the rule leaves out.
 */
export function ruleToForm(rule: string, anchor: LocalDate): RepeatForm | undefined {
  const recur = parseRule(rule);
  if (!recur) return undefined;
  const day = dayOf(anchor);
  const freq = recur.freq as string;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return undefined;

  const used = Object.entries(recur.parts)
    .filter(([, values]) => Array.isArray(values) && values.length > 0)
    .map(([name]) => name);
  const only = (...names: string[]) => used.every((name) => names.includes(name));
  const { BYDAY: byDay = [], BYMONTHDAY: byMonthDay = [], BYMONTH: byMonth = [] } = recur.parts;

  const form = defaultForm(anchor, freq);
  form.interval = recur.interval || 1;
  if (recur.count) {
    form.end = 'count';
    form.count = recur.count;
  } else if (recur.until) {
    form.end = 'until';
    form.until = untilDate(recur.until);
  }

  switch (freq) {
    case 'DAILY':
      return only() ? form : undefined;
    case 'WEEKLY':
      if (!only('BYDAY') || !byDay.every((code) => (WEEK as readonly string[]).includes(code))) return undefined;
      if (byDay.length > 0) form.days = WEEK.filter((code) => byDay.includes(code));
      return form;
    case 'MONTHLY': {
      if (only()) return form;
      if (only('BYMONTHDAY')) return byMonthDay.length === 1 && byMonthDay[0] === day.getDate() ? form : undefined;
      const match = only('BYDAY') && byDay.length === 1 ? /^([+-]?\d)([A-Z]{2})$/.exec(byDay[0]!) : null;
      if (!match || match[2] !== weekdayCode(day)) return undefined;
      const nth = Number(match[1]);
      if (nth === -1 && isLastInMonth(day)) form.monthly = 'last';
      else if (nth === nthInMonth(day) && nth <= 4) form.monthly = 'nth';
      else return undefined;
      return form;
    }
    case 'YEARLY': {
      const sameMonth = byMonth.length === 0 || (byMonth.length === 1 && byMonth[0] === day.getMonth() + 1);
      const sameDay = byMonthDay.length === 0 || (byMonthDay.length === 1 && byMonthDay[0] === day.getDate());
      return only('BYMONTH', 'BYMONTHDAY') && sameMonth && sameDay ? form : undefined;
    }
  }
}

export interface RepeatPreset {
  rule: string;
  label: string;
}

/** The quick choices for a date, as Google Calendar lists them. */
export function presetsFor(anchor: LocalDate): RepeatPreset[] {
  const day = dayOf(anchor);
  const code = weekdayCode(day);
  const rules = ['FREQ=DAILY', `FREQ=WEEKLY;BYDAY=${WORKWEEK.join(',')}`, 'FREQ=WEEKLY', 'FREQ=MONTHLY'];
  if (nthInMonth(day) <= 4) rules.push(`FREQ=MONTHLY;BYDAY=${nthInMonth(day)}${code}`);
  if (isLastInMonth(day)) rules.push(`FREQ=MONTHLY;BYDAY=-1${code}`);
  rules.push('FREQ=YEARLY');
  return rules.map((rule) => ({
    rule,
    label: rule.includes('BYDAY=MO,TU') ? 'Every weekday (Monday to Friday)' : describeRepeat(rule, anchor),
  }));
}

/** How a monthly repeat can follow a date: on day 2, on the 1st Friday, on the last Friday. */
export function monthlyChoices(anchor: LocalDate): { value: RepeatForm['monthly']; label: string }[] {
  const day = dayOf(anchor);
  const weekday = day.toLocaleDateString('en', { weekday: 'long' });
  const choices: { value: RepeatForm['monthly']; label: string }[] = [{ value: 'day', label: `On day ${day.getDate()}` }];
  if (nthInMonth(day) <= 4) choices.push({ value: 'nth', label: `On the ${ordinal(nthInMonth(day))} ${weekday}` });
  if (isLastInMonth(day)) choices.push({ value: 'last', label: `On the last ${weekday}` });
  return choices;
}

/**
 * The same kind of repeat for a new date: "every week on Friday" becomes "every week on Monday" when the
 * date moves to a Monday, as in Google Calendar. Rules the form can't show are left as they are.
 */
export function moveRule(rule: string, from: LocalDate, to: LocalDate, allDay: boolean): string {
  const form = ruleToForm(rule, from);
  if (!form || from.date === to.date) return rule;
  const fromCode = weekdayCode(dayOf(from));
  if (form.freq === 'WEEKLY' && form.days.length === 1 && form.days[0] === fromCode) form.days = [weekdayCode(dayOf(to))];
  if (form.monthly === 'last' && !isLastInMonth(dayOf(to))) form.monthly = 'nth';
  const moved = formToRule(form, to, allDay);
  return sameRule(moved, rule, to) ? rule : moved;
}

/**
 * The first occurrence on or after the date. A rule for Mondays set on a Friday starts on the next Monday,
 * as in Todoist; the date itself when it already fits, or when nothing can be worked out.
 */
export function firstOccurrence(rule: string, anchor: LocalDate): LocalDate {
  const recur = parseRule(rule);
  if (!recur) return anchor;
  // Only the pattern matters here; the end is checked apart (repeatProblem).
  recur.count = null;
  recur.until = null;
  try {
    const next = recur.iterator(ICAL.Time.fromDateString(anchor.date)).next();
    return next ? { ...anchor, date: `${next.year}-${pad(next.month)}-${pad(next.day)}` } : anchor;
  } catch {
    return anchor;
  }
}

/** The rule with its UNTIL in the dates' type, after "All day" was switched. */
export function withUntilFor(rule: string, allDay: boolean): string {
  const recur = parseRule(rule);
  if (!recur?.until || recur.until.isDate === allDay) return rule;
  recur.until = untilTime(untilDate(recur.until), allDay);
  return recur.toString();
}

/** Why a rule can't be saved as it is, if it can't. */
export function repeatProblem(rule: string, anchor: LocalDate | undefined): string | null {
  const recur = parseRule(rule);
  if (!recur || !anchor) return null;
  if (recur.until && untilDate(recur.until) < anchor.date) return 'The repeat ends before the task’s date.';
  return null;
}
