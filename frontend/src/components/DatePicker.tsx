import { useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { describeDue, type DueTone } from '../format.ts';
import { useColors, type Colors } from '../theme.ts';
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
import { dueColor } from './TaskItem.tsx';
import { IconButton } from './ui.tsx';

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
  icon: (color: string) => ReactNode;
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
  const day = parse(today).getDate();
  const choices: QuickChoice[] = [
    { key: 'today', label: 'Today', date: today, icon: (color) => <TodayIcon day={day} color={color} />, hint: short(today) },
    { key: 'tomorrow', label: 'Tomorrow', date: addDays(today, 1), icon: (color) => <SunIcon color={color} />, hint: short(addDays(today, 1)) },
    {
      key: 'weekend',
      label: weekend ? 'Next weekend' : 'This weekend',
      date: saturday,
      icon: (color) => <WeekendIcon color={color} />,
      hint: withDay(saturday),
    },
    { key: 'next-week', label: 'Next week', date: monday, icon: (color) => <NextWeekIcon color={color} />, hint: withDay(monday) },
  ];
  if (clearable) choices.push({ key: 'none', label: 'No date', date: undefined, icon: (color) => <NoDateIcon color={color} /> });
  return choices;
}

/** Todoist's colors for the quick choices' icons. */
const quickColor = (colors: Colors, key: string) =>
  ({ today: colors.dueToday, tomorrow: colors.dueTomorrow, weekend: colors.p3, 'next-week': colors.dueWeek })[key] ??
  colors.textTertiary;

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
}: Props) {
  const colors = useColors();
  const trigger = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const text = value
    ? longLabel
      ? parse(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : describeDue({ date: value }).label
    : placeholder;
  const textColor = !value ? colors.textTertiary : tone ? dueColor(colors, tone) : colors.text;

  return (
    <>
      <Pressable
        ref={trigger}
        role="button"
        aria-label={value ? `${label}: ${longDate(value)}` : `${label}: none`}
        aria-expanded={open}
        onPress={() => setOpen(true)}
        style={({ pressed, hovered }) => [
          styles.trigger,
          { borderColor: colors.border, backgroundColor: pressed || hovered || open ? colors.bgHover : colors.bg },
        ]}
      >
        <CalendarIcon color={textColor} />
        <Text style={[styles.triggerText, { color: textColor }]} numberOfLines={1}>
          {text}
        </Text>
      </Pressable>
      {open && (
        <Popover anchor={trigger} onClose={() => setOpen(false)} width={272} maxHeight={560}>
          <Calendar
            value={value}
            min={min}
            clearable={clearable && value !== undefined}
            label={label}
            onPick={(date) => {
              setOpen(false);
              if (date !== value) onChange(date);
            }}
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
}

function Calendar({ value, min, clearable, label, onPick }: CalendarProps) {
  const colors = useColors();
  const today = iso(new Date());
  const [month, setMonth] = useState(monthOf(value ?? (min && min > today ? min : today)));

  const first = `${month}-01`;
  const blanks = weekdayIndex(first);
  const daysInMonth = new Date(parse(first).getFullYear(), parse(first).getMonth() + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => `${month}-${pad(i + 1)}`);
  const title = parse(first).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const earliestMonth = min && monthOf(min);
  // Whole weeks: blanks before the 1st and after the last day, so every row has seven cells.
  const cells: (string | null)[] = [...Array<null>(blanks).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  return (
    <View role="dialog" aria-label={label}>
      <View style={[styles.quickList, { borderBottomColor: colors.divider }]}>
        {quickChoices(today, clearable)
          .filter((choice) => !min || !choice.date || choice.date >= min)
          .map((choice) => (
            <Pressable
              key={choice.key}
              role="button"
              aria-pressed={choice.date === value}
              onPress={() => onPick(choice.date)}
              style={({ pressed, hovered }) => [styles.quick, (pressed || hovered) && { backgroundColor: colors.bgHover }]}
            >
              <View style={styles.quickIcon}>{choice.icon(quickColor(colors, choice.key))}</View>
              <Text style={[styles.quickLabel, { color: colors.text }]}>{choice.label}</Text>
              {choice.hint && <Text style={[styles.quickHint, { color: colors.textTertiary }]}>{choice.hint}</Text>}
            </Pressable>
          ))}
      </View>

      <View style={styles.month}>
        <View style={styles.monthHeader}>
          <Text style={[styles.monthTitle, { color: colors.text }]} aria-live="polite">
            {title}
          </Text>
          <IconButton
            label="Previous month"
            size={24}
            disabled={earliestMonth !== undefined && month <= earliestMonth}
            onPress={() => setMonth(monthOf(addMonths(first, -1)))}
          >
            <ChevronLeftIcon color={colors.textSecondary} />
          </IconButton>
          <IconButton label="This month" size={24} disabled={month === monthOf(today)} onPress={() => setMonth(monthOf(today))}>
            <View style={[styles.todayDot, { borderColor: colors.textSecondary }]} />
          </IconButton>
          <IconButton label="Next month" size={24} onPress={() => setMonth(monthOf(addMonths(first, 1)))}>
            <ChevronRightIcon color={colors.textSecondary} />
          </IconButton>
        </View>

        <View style={styles.week} aria-hidden>
          {WEEKDAY_INITIALS.map((initial, i) => (
            <Text key={i} style={[styles.cell, styles.weekday, { color: colors.textTertiary }]}>
              {initial}
            </Text>
          ))}
        </View>

        {weeks.map((week, i) => (
          <View key={i} style={styles.week}>
            {week.map((date, j) => {
              if (!date) return <View key={`blank-${j}`} style={styles.cell} />;
              const selected = date === value;
              const isToday = date === today;
              const disabled = min !== undefined && date < min;
              return (
                <Pressable
                  key={date}
                  role="button"
                  aria-pressed={selected}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={longDate(date)}
                  disabled={disabled}
                  onPress={() => onPick(date)}
                  style={({ pressed, hovered }) => [
                    styles.cell,
                    styles.day,
                    selected
                      ? { backgroundColor: colors.accent }
                      : (pressed || hovered) && !disabled && { backgroundColor: colors.bgHover },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      {
                        color: selected
                          ? colors.accentText
                          : isToday
                            ? colors.accent
                            : date < today || disabled
                              ? colors.textTertiary
                              : colors.text,
                      },
                      (isToday || selected) && styles.bold,
                      disabled && styles.faded,
                    ]}
                  >
                    {Number(date.slice(8))}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 6,
    flexShrink: 1,
  },
  triggerText: { fontSize: 13, flexShrink: 1 },
  quickList: { paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  quick: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 7 },
  quickIcon: { width: 16, alignItems: 'center' },
  quickLabel: { flex: 1, fontSize: 13, fontWeight: '600' },
  quickHint: { fontSize: 12 },
  month: { padding: 8 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 4, paddingLeft: 4 },
  monthTitle: { flex: 1, fontSize: 13, fontWeight: '700' },
  todayDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  week: { flexDirection: 'row' },
  cell: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  weekday: { fontSize: 11, lineHeight: 34 },
  day: { borderRadius: 17 },
  dayText: { fontSize: 13 },
  bold: { fontWeight: '700' },
  faded: { opacity: 0.4 },
});
