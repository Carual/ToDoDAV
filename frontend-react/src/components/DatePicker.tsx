import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { describeDue, type DueTone } from '../format.ts';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  NextWeekIcon,
  NoDateIcon,
  SunIcon,
  TodayIcon,
  WeekendIcon,
} from './icons.tsx';
import { Popover } from './Popover.tsx';

interface Props {
  /** The date as YYYY-MM-DD, or undefined for none. */
  value: string | undefined;
  onChange: (date: string | undefined) => void;
  'aria-label': string;
  /** Colors the label by urgency, as due dates are. */
  tone?: DueTone;
  /** The earliest date that can be picked (YYYY-MM-DD). */
  min?: string;
  /** Offers "No date" in the menu. */
  clearable?: boolean;
  /** The full date ("3 Oct 2026") rather than Todoist's "Friday", "Tomorrow"... */
  longLabel?: boolean;
  placeholder?: string;
  className?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (date: string) => new Date(`${date}T00:00`);
const addDays = (date: string, days: number) => {
  const d = parse(date);
  d.setDate(d.getDate() + days);
  return iso(d);
};
/** Moves by whole months, keeping the day where the month has it (31 Jan + 1 month = 28 Feb). */
const addMonths = (date: string, months: number) => {
  const d = parse(date);
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return iso(target);
};
const monthOf = (date: string) => date.slice(0, 7);
/** Monday first, like the repeat form. */
const weekdayIndex = (date: string) => (parse(date).getDay() + 6) % 7;
const longDate = (date: string) =>
  parse(date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
// 1 January 2024 was a Monday.
const WEEKDAY_INITIALS = Array.from({ length: 7 }, (_, i) =>
  new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }),
);

interface QuickChoice {
  key: string;
  label: string;
  date: string | undefined;
  icon: ReactNode;
  hint?: string;
}

/** Todoist's shortcuts: today, tomorrow, the coming weekend, next Monday. */
function quickChoices(today: string, clearable: boolean): QuickChoice[] {
  const weekday = weekdayIndex(today);
  const weekend = weekday >= 5; // already Saturday or Sunday: the next one
  const saturday = addDays(today, weekend ? 12 - weekday : 5 - weekday);
  const monday = addDays(today, 7 - weekday);
  const short = (date: string) => parse(date).toLocaleDateString(undefined, { weekday: 'short' });
  const withDay = (date: string) => parse(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const choices: QuickChoice[] = [
    { key: 'today', label: 'Today', date: today, icon: <TodayIcon day={parse(today).getDate()} />, hint: short(today) },
    { key: 'tomorrow', label: 'Tomorrow', date: addDays(today, 1), icon: <SunIcon />, hint: short(addDays(today, 1)) },
    { key: 'weekend', label: weekend ? 'Next weekend' : 'This weekend', date: saturday, icon: <WeekendIcon />, hint: withDay(saturday) },
    { key: 'next-week', label: 'Next week', date: monday, icon: <NextWeekIcon />, hint: withDay(monday) },
  ];
  if (clearable) choices.push({ key: 'none', label: 'No date', date: undefined, icon: <NoDateIcon /> });
  return choices;
}

/** A date field that opens Todoist's scheduler: quick choices on top, a month calendar under them. */
export function DatePicker({
  value,
  onChange,
  'aria-label': label,
  tone,
  min,
  clearable = false,
  longLabel = false,
  placeholder = 'No date',
  className = '',
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  const text = value
    ? longLabel
      ? parse(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : describeDue({ date: value }).label
    : placeholder;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`select date-trigger ${className}`}
        aria-label={value ? `${label}: ${longDate(value)}` : `${label}: none`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={value ? longDate(value) : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <CalendarIcon className="date-trigger-icon" />
        <span className={`select-value${value ? (tone ? ` due-${tone}` : '') : ' muted'}`}>{text}</span>
      </button>
      {open && (
        <Popover anchor={triggerRef} onClose={() => close(false)} className="date-popover">
          <Calendar
            value={value}
            min={min}
            clearable={clearable && value !== undefined}
            label={label}
            onPick={(date) => {
              close(true);
              if (date !== value) onChange(date);
            }}
            onCancel={() => close(true)}
          />
        </Popover>
      )}
    </>
  );
}

interface CalendarProps {
  value: string | undefined;
  min: string | undefined;
  clearable: boolean;
  label: string;
  onPick: (date: string | undefined) => void;
  onCancel: () => void;
}

function Calendar({ value, min, clearable, label, onPick, onCancel }: CalendarProps) {
  const today = iso(new Date());
  const rootRef = useRef<HTMLDivElement>(null);
  /** The day the arrow keys move from; its month is the one shown. */
  const [focused, setFocused] = useState(value ?? (min && min > today ? min : today));
  const [month, setMonth] = useState(monthOf(focused));
  /** Only keyboard moves take the focus along: clicking the month arrows must leave it on them. */
  const moveFocus = useRef(true);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    const day = rootRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`);
    // Somewhere inside it in any case, so Escape and Tab reach the picker.
    (day && !day.disabled ? day : rootRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
  }, [focused]);

  function focusDay(date: string) {
    if (min && date < min) date = min;
    moveFocus.current = true;
    setFocused(date);
    setMonth(monthOf(date));
  }

  function showMonth(by: number) {
    const next = addMonths(`${month}-01`, by);
    setMonth(monthOf(next));
    setFocused(next);
  }

  function onDayKey(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      Home: () => addDays(date, -weekdayIndex(date)),
      End: () => addDays(date, 6 - weekdayIndex(date)),
      PageUp: () => addMonths(date, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(date, event.shiftKey ? 12 : 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    focusDay(move());
  }

  /** Escape closes the picker only; Tab goes round inside it, as in a dialog. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
    }
    if (event.key !== 'Tab') return;
    const stops = [...rootRef.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([tabindex="-1"])')];
    const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
    if (document.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? stops[stops.length - 1] : stops[0])?.focus();
    }
  }

  const first = `${month}-01`;
  const blanks = weekdayIndex(first);
  const daysInMonth = new Date(parse(first).getFullYear(), parse(first).getMonth() + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => `${month}-${pad(i + 1)}`);
  const title = parse(first).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const earliestMonth = min && monthOf(min);

  return (
    <div ref={rootRef} className="date-picker" role="dialog" aria-label={label} onKeyDown={onKeyDown}>
      <div className="date-quick-list">
        {quickChoices(today, clearable)
          .filter((choice) => !min || !choice.date || choice.date >= min)
          .map((choice) => (
            <button
              key={choice.key}
              type="button"
              className={`date-quick date-quick-${choice.key}`}
              aria-pressed={choice.date === value}
              onClick={() => onPick(choice.date)}
            >
              <span className="date-quick-icon">{choice.icon}</span>
              <span className="date-quick-label">{choice.label}</span>
              {choice.hint && <span className="date-quick-hint">{choice.hint}</span>}
            </button>
          ))}
      </div>

      <div className="date-month">
        <div className="date-month-header">
          <span className="date-month-title" aria-live="polite">
            {title}
          </span>
          <button
            type="button"
            className="icon-btn icon-btn-small"
            aria-label="Previous month"
            title="Previous month"
            disabled={earliestMonth !== undefined && month <= earliestMonth}
            onClick={() => showMonth(-1)}
          >
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-small date-month-today"
            aria-label="This month"
            title="This month"
            disabled={month === monthOf(today)}
            onClick={() => {
              setMonth(monthOf(today));
              setFocused(today);
            }}
          >
            <span aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-small"
            aria-label="Next month"
            title="Next month"
            onClick={() => showMonth(1)}
          >
            <ChevronRightIcon />
          </button>
        </div>

        <div className="date-weekdays" aria-hidden="true">
          {WEEKDAY_INITIALS.map((initial, i) => (
            <span key={i}>{initial}</span>
          ))}
        </div>

        <div className="date-grid">
          {Array.from({ length: blanks }, (_, i) => (
            <span key={`blank-${i}`} />
          ))}
          {days.map((date) => {
            const classes = ['date-day'];
            if (date === today) classes.push('today');
            if (date < today) classes.push('past');
            if (date === value) classes.push('selected');
            return (
              <button
                key={date}
                type="button"
                className={classes.join(' ')}
                data-date={date}
                // One day in the tab order; the arrow keys move between them.
                tabIndex={date === focused ? 0 : -1}
                disabled={min !== undefined && date < min}
                aria-pressed={date === value}
                aria-current={date === today ? 'date' : undefined}
                aria-label={longDate(date)}
                onKeyDown={(event) => onDayKey(event, date)}
                onFocus={() => setFocused(date)}
                onClick={() => onPick(date)}
              >
                {Number(date.slice(8))}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
