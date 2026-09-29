import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MoreIcon } from './icons.tsx';
import { Popover } from './Popover.tsx';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  title?: string;
  /** Shown in red: an action that removes something, such as deleting. */
  danger?: boolean;
  onSelect: () => void;
}

interface Props {
  items: MenuItem[];
  'aria-label': string;
}

/**
 * A three-dots button with a list of actions, built as the ARIA menu button: opening it moves the focus into the
 * menu, the arrow keys go through it, and Escape gives the focus back to the button.
 */
export function Menu({ items, 'aria-label': label }: Props) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[active]?.focus();
  }, [open, active]);

  function show(index: number) {
    setActive(index);
    setOpen(true);
  }

  /** Closes the menu and gives the focus back to its button. */
  function close() {
    triggerRef.current?.focus();
    setOpen(false);
  }

  function select(item: MenuItem) {
    // The focus goes back first, so a dialog the action opens returns it to the button, not to a removed item.
    close();
    item.onSelect();
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') show(0);
    else if (event.key === 'ArrowUp') show(items.length - 1);
    else return;
    event.preventDefault();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = items.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        setActive((index) => (index === last ? 0 : index + 1));
        break;
      case 'ArrowUp':
        setActive((index) => (index === 0 ? last : index - 1));
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(last);
        break;
      case 'Escape':
        // Closes the menu only, not the modal it sits in.
        event.stopPropagation();
        close();
        break;
      case 'Tab':
        // The menu lives in <body>, so Tab would leave the modal: go back to the button instead.
        close();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn menu-trigger"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? setOpen(false) : show(0))}
        onKeyDown={onTriggerKeyDown}
      >
        <MoreIcon />
      </button>
      {open && (
        <Popover anchor={triggerRef} onClose={() => setOpen(false)} align="end" className="menu">
          <div ref={menuRef} id={id} role="menu" aria-label={label} onKeyDown={onMenuKeyDown}>
            {items.map((item, index) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`menu-item${item.danger ? ' menu-item-danger' : ''}`}
                title={item.title}
                onMouseMove={() => index !== active && setActive(index)}
                onClick={() => select(item)}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
