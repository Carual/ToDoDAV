import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { LocalDate } from '../../api/tasks.ts';
import { describeRepeat } from '../../lib/format.ts';
import {
  defaultForm,
  formToRule,
  monthlyChoices,
  presetsFor,
  ruleToForm,
  sameRule,
  WEEK,
  type Frequency,
  type RepeatForm,
} from '../../lib/repeat.ts';
import { useColors, fs } from '../../theme.ts';
import { DatePicker } from '../controls/DatePicker.tsx';
import { Select, type SelectOption } from '../controls/Select.tsx';
import { SwitchRow } from '../controls/ui.tsx';

interface Props {
  /** The RRULE value, or undefined when the task doesn't repeat. */
  value: string | undefined;
  /** The date the repeat counts from: the start date, or else the due date (today when there is none yet). */
  anchor: LocalDate;
  allDay: boolean;
  onChange: (rule: string | undefined) => void;
}

const FREQUENCIES: Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const UNITS: Record<Frequency, [one: string, many: string]> = {
  DAILY: ['day', 'days'],
  WEEKLY: ['week', 'weeks'],
  MONTHLY: ['month', 'months'],
  YEARLY: ['year', 'years'],
};
const DAY_NAMES: Record<string, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};

const ENDS: SelectOption<RepeatForm['end']>[] = [
  { value: 'never', label: 'Never' },
  { value: 'until', label: 'On' },
  { value: 'count', label: 'After' },
];

const validForm = (form: RepeatForm) =>
  form.interval >= 1 && (form.end !== 'count' || form.count >= 1) && (form.end !== 'until' || form.until !== '');

/** A typed number, kept between 0 (being retyped) and 999. */
const toCount = (text: string) => Math.min(999, Math.max(0, Math.trunc(Number(text.replace(/\D/g, '')) || 0)));

/**
 * "Repeat": a switch, and while it is on, Google Calendar's quick choices for the task's date and a custom form
 * (every N days, weeks, months or years; which weekdays; which day of the month; when it ends). A rule from another
 * app that the choices don't cover stays selected as it is until another one is picked.
 */
export function RepeatField({ value, anchor, allDay, onChange }: Props) {
  const colors = useColors();
  const presets = presetsFor(anchor);
  /** The custom form, while it is open. */
  const [form, setForm] = useState<RepeatForm | null>(null);

  // The date (or the rule, moved along with it) changed underneath: show what the rule says now.
  useEffect(() => {
    setForm((open) => (open && value ? (ruleToForm(value, anchor) ?? open) : open));
  }, [value, anchor.date]); // the date, not the object holding it, which is new on every render

  const presetIndex = value === undefined ? -1 : presets.findIndex((preset) => sameRule(preset.rule, value, anchor));
  const selected = form ? 'custom' : presetIndex >= 0 ? `preset:${presetIndex}` : 'current';

  function choose(option: string) {
    if (option === 'custom') {
      const next = (value && ruleToForm(value, anchor)) || defaultForm(anchor);
      setForm(next);
      onChange(formToRule(next, anchor, allDay));
      return;
    }
    if (option === 'current') return; // the rule as it already is
    setForm(null);
    onChange(presets[Number(option.slice('preset:'.length))]!.rule);
  }

  /** On starts with the first choice (every day); off drops the rule and closes the custom form. */
  function toggle(on: boolean) {
    setForm(null);
    onChange(on ? presets[0]!.rule : undefined);
  }

  function edit(patch: Partial<RepeatForm>) {
    if (!form) return;
    const next = { ...form, ...patch };
    setForm(next);
    // A number being retyped (empty for a moment) keeps the last rule until it is valid again.
    if (validForm(next)) onChange(formToRule(next, anchor, allDay));
  }

  const numberInput = [styles.number, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }];
  const label = [styles.text, { color: colors.textSecondary }];

  return (
    <View style={styles.field}>
      <SwitchRow label="Repeat" value={value !== undefined} onChange={toggle} />

      {value !== undefined && (
        <Select<string>
          value={selected}
          onChange={choose}
          aria-label="Repeat"
          options={[
            ...presets.map((preset, index) => ({ value: `preset:${index}`, label: preset.label })),
            ...(selected === 'current' ? [{ value: 'current', label: describeRepeat(value, anchor) }] : []),
            { value: 'custom', label: 'Custom…' },
          ]}
        />
      )}

      {form && (
        <View style={styles.custom}>
          <View style={styles.row}>
            <Text style={label}>Every</Text>
            <TextInput
              style={numberInput}
              keyboardType="number-pad"
              value={form.interval ? String(form.interval) : ''}
              onChangeText={(text) => edit({ interval: toCount(text) })}
              aria-label="Repeat every"
              maxLength={3}
            />
            <Select
              value={form.freq}
              onChange={(freq) => edit({ freq })}
              aria-label="Repeat unit"
              options={FREQUENCIES.map((freq) => ({ value: freq, label: UNITS[freq][form.interval === 1 ? 0 : 1] }))}
            />
          </View>

          {form.freq === 'WEEKLY' && (
            <View style={styles.days} role="group" aria-label="Repeat on">
              {WEEK.map((code) => {
                const on = form.days.includes(code);
                return (
                  <Pressable
                    key={code}
                    role="checkbox"
                    aria-checked={on}
                    aria-label={DAY_NAMES[code]}
                    onPress={() => {
                      const days = on ? form.days.filter((d) => d !== code) : [...form.days, code];
                      if (days.length > 0) edit({ days }); // at least one day stays on
                    }}
                    style={[
                      styles.day,
                      on ? { backgroundColor: colors.accent, borderColor: colors.accent } : { borderColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.dayText, { color: on ? colors.accentText : colors.textSecondary }]}>{code[0]}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {form.freq === 'MONTHLY' && (
            <Select
              value={form.monthly}
              onChange={(monthly) => edit({ monthly })}
              aria-label="Day of the month"
              options={monthlyChoices(anchor)}
            />
          )}

          <View style={styles.row}>
            <Text style={label}>Ends</Text>
            <Select value={form.end} onChange={(end) => edit({ end })} aria-label="Ends" options={ENDS} />
            {form.end === 'until' && (
              <DatePicker
                value={form.until || undefined}
                min={anchor.date}
                longLabel
                placeholder="Pick a date"
                onChange={(until) => until && edit({ until })}
                aria-label="Last date"
              />
            )}
            {form.end === 'count' && (
              <>
                <TextInput
                  style={numberInput}
                  keyboardType="number-pad"
                  value={form.count ? String(form.count) : ''}
                  onChangeText={(text) => edit({ count: toCount(text) })}
                  aria-label="Number of times"
                  maxLength={3}
                />
                <Text style={label}>{form.count === 1 ? 'time' : 'times'}</Text>
              </>
            )}
          </View>
        </View>
      )}

      {form && value && <Text style={[styles.summary, { color: colors.textTertiary }]}>{describeRepeat(value, anchor)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  custom: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  text: { fontSize: fs(13) },
  number: {
    width: 52,
    minHeight: 32,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 6,
    fontSize: fs(13),
    textAlign: 'center',
    outlineWidth: 0,
  },
  days: { flexDirection: 'row', gap: 4 },
  day: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: fs(12), fontWeight: '600' },
  summary: { fontSize: fs(12) },
});
