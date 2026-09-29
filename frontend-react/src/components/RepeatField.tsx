import { useEffect, useState } from 'react';
import type { LocalDate } from '../api/tasks.ts';
import { describeRepeat } from '../format.ts';
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
} from '../repeat.ts';
import { DatePicker } from './DatePicker.tsx';
import { Select, type SelectOption } from './Select.tsx';

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

const validForm =(form: RepeatForm) =>
  form.interval >= 1 && (form.end !== 'count' || form.count >= 1) && (form.end !== 'until' || form.until !== '');

/**
 * "Repeat": a switch, and while it is on, Google Calendar's quick choices for the task's date and a custom form (every N days, weeks,
 * months or years; which weekdays; which day of the month; when it ends). A rule from another app that the
 * choices don't cover stays selected as it is until another one is picked.
 */
export function RepeatField({ value, anchor, allDay, onChange }: Props) {
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

  return (
    <div className="date-field repeat-field">
      <label className="repeat-header switch">
        <span className="date-field-label">Repeat</span>
        <input type="checkbox" checked={value !== undefined} onChange={(e) => toggle(e.target.checked)} />
        <span className="switch-track" aria-hidden="true" />
      </label>

      {value !== undefined && (
        <Select<string>
          className="repeat-select"
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
        <div className="repeat-custom">
          <div className="repeat-row">
            <span>Every</span>
            <input
              type="number"
              className="sidebar-text repeat-number"
              min={1}
              max={999}
              value={form.interval || ''}
              onChange={(e) => edit({ interval: Math.min(999, Math.max(0, Math.trunc(Number(e.target.value)))) })}
              aria-label="Repeat every"
            />
            <Select
              value={form.freq}
              onChange={(freq) => edit({ freq })}
              aria-label="Repeat unit"
              options={FREQUENCIES.map((freq) => ({ value: freq, label: UNITS[freq][form.interval === 1 ? 0 : 1] }))}
            />
          </div>

          {form.freq === 'WEEKLY' && (
            <div className="repeat-days" role="group" aria-label="Repeat on">
              {WEEK.map((code) => {
                const on = form.days.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    className={`repeat-day${on ? ' on' : ''}`}
                    aria-pressed={on}
                    aria-label={DAY_NAMES[code]}
                    title={DAY_NAMES[code]}
                    onClick={() => {
                      const days = on ? form.days.filter((d) => d !== code) : [...form.days, code];
                      if (days.length > 0) edit({ days }); // at least one day stays on
                    }}
                  >
                    {code[0]}
                  </button>
                );
              })}
            </div>
          )}

          {form.freq === 'MONTHLY' && (
            <Select
              className="repeat-select"
              value={form.monthly}
              onChange={(monthly) => edit({ monthly })}
              aria-label="Day of the month"
              options={monthlyChoices(anchor)}
            />
          )}

          <div className="repeat-row">
            <span>Ends</span>
            <Select
              className="repeat-ends"
              value={form.end}
              onChange={(end) => edit({ end })}
              aria-label="Ends"
              options={ENDS}
            />
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
                <input
                  type="number"
                  className="sidebar-text repeat-number"
                  min={1}
                  max={999}
                  value={form.count || ''}
                  onChange={(e) => edit({ count: Math.min(999, Math.max(0, Math.trunc(Number(e.target.value)))) })}
                  aria-label="Number of times"
                />
                <span>{form.count === 1 ? 'time' : 'times'}</span>
              </>
            )}
          </div>
        </div>
      )}

      {form && value && <span className="sidebar-note repeat-summary">{describeRepeat(value, anchor)}</span>}
    </div>
  );
}
