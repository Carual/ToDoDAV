import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { formatTime } from '../format.ts';
import { ClockIcon } from './icons.tsx';
import { Popover } from './Popover.tsx';

interface Props {
  /** HH:MM, or undefined for none yet. */
  value: string | undefined;
  onChange: (time: string) => void;
  'aria-label': string;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Every half hour, like Todoist's time list; any other time can be typed. */
const SLOTS = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`);
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const nearestSlot = (time: string) => Math.min(SLOTS.length - 1, Math.round(minutesOf(time) / 30));

/**
 * Reads a typed time: "9", "930", "9:30", "9.30", "21h", "9pm", "9:30 a. m."... into HH:MM. Undefined when it
 * isn't one.
 */
export function parseTime(text: string): string | undefined {
  const cleaned = text
    .toLowerCase()
    .replace(/\s+/g, '') // also the narrow no-break space some locales put before AM/PM
    .replace(/([ap])\.?m\.?$/, '$1m');
  const match = /^(\d{1,2})(?:[:.h]?(\d{2}))?h?(am|pm|a|p)?$/.exec(cleaned);
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const half = match[3]?.[0];
  if (half && (hours < 1 || hours > 12)) return undefined;
  if (half === 'p' && hours < 12) hours += 12;
  if (half === 'a' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return undefined;
  return `${pad(hours)}:${pad(minutes)}`;
}

/** A time box that can be typed in, with a list of times under it while it has the focus. */
export function TimeField({ value, onChange, 'aria-label': label }: Props) {
  const id = useId();
  const boxRef = useRef<HTMLLabelElement>(null);
  /** The text being typed; null while showing the value. */
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function show() {
    setActive(nearestSlot(value ?? '09:00'));
    setOpen(true);
  }

  /** Keeps what was typed if it is a time, and otherwise goes back to the value. */
  function commit(time = draft === null ? undefined : parseTime(draft)) {
    setDraft(null);
    setOpen(false);
    if (time && time !== value) onChange(time);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!open) return show();
        const next = Math.max(0, Math.min(SLOTS.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
        setActive(next);
        setDraft(formatTime(SLOTS[next]!));
        return;
      }
      case 'Enter':
        if (!open && draft === null) return;
        event.preventDefault();
        commit();
        return;
      case 'Escape':
        if (!open && draft === null) return; // nothing to undo: the modal may close
        event.stopPropagation();
        setDraft(null);
        setOpen(false);
    }
  }

  return (
    // A label, so the clock icon also puts the focus in the box.
    <label ref={boxRef} className="time-field">
      <ClockIcon className="time-field-icon" />
      <input
        className="time-input"
        value={draft ?? (value ? formatTime(value) : '')}
        placeholder="Time"
        aria-label={label}
        role="combobox"
        aria-autocomplete="none"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        autoComplete="off"
        onFocus={(event) => {
          event.target.select();
          show();
        }}
        onClick={() => !open && show()}
        onBlur={() => commit()}
        onChange={(event) => {
          setDraft(event.target.value);
          const time = parseTime(event.target.value);
          if (time) setActive(nearestSlot(time));
          if (!open) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <Popover anchor={boxRef} onClose={() => setOpen(false)} maxHeight={240} className="select-menu time-menu">
          <ul id={`${id}-list`} role="listbox" aria-label={label}>
            {SLOTS.map((slot, index) => (
              <li
                key={slot}
                id={optionId(index)}
                role="option"
                aria-selected={slot === value}
                className={index === active ? 'select-option active' : 'select-option'}
                // The focus stays in the box, so typing still works.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => commit(slot)}
              >
                {formatTime(slot)}
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </label>
  );
}
