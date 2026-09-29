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

const validForm = (form: RepeatForm) =>
  form.interval >= 1 && (form.end !== 'count' || form.count >= 1) && (form.end !== 'until' || form.until !== '');

/**
 * "Repeat": Google Calendar's quick choices for the task's date, and a custom form (every N days, weeks,
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
  const selected = form ? 'custom' : value === undefined ? 'none' : presetIndex >= 0 ? `preset:${presetIndex}` : 'current';

  function choose(option: string) {
    if (option === 'custom') {
      const next = (value && ruleToForm(value, anchor)) || defaultForm(anchor);
      setForm(next);
      onChange(formToRule(next, anchor, allDay));
      return;
    }
    if (option === 'current') return; // the rule as it already is
    setForm(null);
    onChange(option === 'none' ? undefined : presets[Number(option.slice('preset:'.length))]!.rule);
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
      <span className="date-field-label">Repeat</span>
      <select className="sidebar-text" value={selected} onChange={(e) => choose(e.target.value)} aria-label="Repeat">
        <option value="none">Does not repeat</option>
        {presets.map((preset, index) => (
          <option key={preset.rule} value={`preset:${index}`}>
            {preset.label}
          </option>
        ))}
        {selected === 'current' && value && <option value="current">{describeRepeat(value, anchor)}</option>}
        <option value="custom">Custom…</option>
      </select>

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
            <select
              className="sidebar-text"
              value={form.freq}
              onChange={(e) => edit({ freq: e.target.value as Frequency })}
              aria-label="Repeat unit"
            >
              {FREQUENCIES.map((freq) => (
                <option key={freq} value={freq}>
                  {UNITS[freq][form.interval === 1 ? 0 : 1]}
                </option>
              ))}
            </select>
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
            <select
              className="sidebar-text repeat-wide"
              value={form.monthly}
              onChange={(e) => edit({ monthly: e.target.value as RepeatForm['monthly'] })}
              aria-label="Day of the month"
            >
              {monthlyChoices(anchor).map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          )}

          <div className="repeat-row">
            <span>Ends</span>
            <select
              className="sidebar-text"
              value={form.end}
              onChange={(e) => edit({ end: e.target.value as RepeatForm['end'] })}
              aria-label="Ends"
            >
              <option value="never">Never</option>
              <option value="until">On</option>
              <option value="count">After</option>
            </select>
            {form.end === 'until' && (
              <input
                type="date"
                className="sidebar-text"
                value={form.until}
                min={anchor.date}
                onChange={(e) => edit({ until: e.target.value })}
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
