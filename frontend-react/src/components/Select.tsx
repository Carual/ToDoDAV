import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon } from './icons.tsx';
import { Popover } from './Popover.tsx';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface Props<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  'aria-label': string;
  disabled?: boolean;
  className?: string;
}

/**
 * A dropdown in the app's own style, in place of the browser's <select>. Built as the ARIA "select-only combobox":
 * the focus stays on the button and the arrow keys move through the list.
 */
export function Select<T extends string>({ value, options, onChange, 'aria-label': label, disabled = false, className = '' }: Props<T>) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function show() {
    setActive(Math.max(0, selectedIndex));
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    setOpen(false);
    if (option && option.value !== value) onChange(option.value);
  }

  /** Typing a letter jumps to the next option starting with it, as in a native select. */
  function jumpTo(letter: string) {
    const from = open ? active : Math.max(0, selectedIndex);
    for (let step = 1; step <= options.length; step++) {
      const index = (from + step) % options.length;
      if (options[index]!.label.toLowerCase().startsWith(letter)) return index;
    }
    return -1;
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        setActive((index) => Math.min(last, index + 1));
        break;
      case 'ArrowUp':
        setActive((index) => Math.max(0, index - 1));
        break;
      case 'Home':
      case 'PageUp':
        setActive(0);
        break;
      case 'End':
      case 'PageDown':
        setActive(last);
        break;
      case 'Enter':
      case ' ':
        choose(active);
        break;
      case 'Escape':
        // Closes the list only, not the modal it sits in.
        event.stopPropagation();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        return;
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
        const index = jumpTo(event.key.toLowerCase());
        if (index >= 0) setActive(index);
      }
    }
    event.preventDefault();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className={`select ${className}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        // Some browsers click a button when Space comes back up, even with the key press handled.
        onKeyUp={(event) => event.key === ' ' && event.preventDefault()}
      >
        {selected?.icon}
        <span className="select-value">{selected?.label}</span>
        <ChevronDownIcon className="select-chevron" />
      </button>
      {open && (
        <Popover anchor={triggerRef} onClose={() => setOpen(false)} matchWidth className="select-menu">
          <ul id={`${id}-list`} role="listbox" aria-label={label}>
            {options.map((option, index) => (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={option.value === value}
                className={index === active ? 'select-option active' : 'select-option'}
                // The focus stays on the button, which owns the keyboard.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                {option.icon}
                <span className="select-option-label">{option.label}</span>
                {option.value === value && <CheckIcon className="select-check" />}
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </>
  );
}
