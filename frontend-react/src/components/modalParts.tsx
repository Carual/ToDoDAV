import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LocalDate } from '../api/ical.ts';
import { describeDue } from '../format.ts';
import { todayDate } from '../repeat.ts';
import { useLeaveGuard } from '../router.ts';
import { DatePicker } from './DatePicker.tsx';
import { CloseIcon, PencilIcon } from './icons.tsx';
import { TimeField } from './TimeField.tsx';

// What the task modal and the journal modal share.

/** Time given to a date when "All day" is switched off. */
export const DEFAULT_TIME = '09:00';

/**
 * The "Save changes?" question for a modal with unsaved work. One question at a time: every way out (close
 * controls, Back/Forward) waits on the same answer, which only says whether to go on leaving. Saving, when
 * chosen, is done by the dialog itself.
 */
export function useLeavePrompt(guarded: boolean) {
  const [asking, setAsking] = useState(false);
  const answerRef = useRef<{ promise: Promise<boolean>; resolve: (leave: boolean) => void } | null>(null);

  const ask = useCallback((): Promise<boolean> => {
    if (!answerRef.current) {
      let resolve!: (leave: boolean) => void;
      const promise = new Promise<boolean>((r) => (resolve = r));
      answerRef.current = { promise, resolve };
      setAsking(true);
    }
    return answerRef.current.promise;
  }, []);

  function answer(leave: boolean) {
    answerRef.current?.resolve(leave);
    answerRef.current = null;
    setAsking(false);
  }

  // Closing for another reason while asking must still settle the question (the router waits on it).
  useEffect(() => () => answerRef.current?.resolve(false), []);

  // Back/Forward ask too, not only the modal's own close controls.
  useLeaveGuard(guarded, ask);

  /** Leaves the modal (to close it or to show something else), asking first if something is unsaved. */
  function leave(then: () => void) {
    if (!guarded) return then();
    void ask().then((agreed) => agreed && then());
  }

  return { asking, answer, leave };
}

interface DateFieldProps {
  label: string;
  value: LocalDate | undefined;
  allDay: boolean;
  /** Color the summary by urgency (overdue, today...), as for due dates. */
  colored?: boolean;
  onChange: (value: LocalDate | undefined) => void;
}

export function DateField({ label, value, allDay, colored = false, onChange }: DateFieldProps) {
  return (
    <div className="date-field">
      <span className="date-field-label">{label}</span>
      <div className="date-field-row">
        <DatePicker
          value={value?.date}
          // The time counts too: a due time already passed today is overdue.
          tone={colored && value ? describeDue(value).tone : undefined}
          clearable
          aria-label={label}
          onChange={(date) => onChange(!date ? undefined : allDay ? { date } : { date, time: value?.time ?? DEFAULT_TIME })}
        />
        {!allDay && (
          <TimeField
            value={value && (value.time ?? DEFAULT_TIME)}
            aria-label={`${label} time`}
            // A time alone means today, as in Todoist.
            onChange={(time) => onChange({ date: value?.date ?? todayDate().date, time })}
          />
        )}
        {value && (
          <button
            type="button"
            className="icon-btn icon-btn-small"
            aria-label={`Remove ${label.toLowerCase()}`}
            title="Remove"
            onClick={() => onChange(undefined)}
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </div>
  );
}

interface MarkdownViewProps {
  className: string;
  /** What the field is, also its placeholder when empty. */
  label: string;
  /** Whether the text has formatting or links, which a click on it is then left to. */
  formatted: boolean;
  onEdit: () => void;
  children: ReactNode;
}

/**
 * The formatted text of a field. Plain text opens its editor when focused (a click, or Tab). Text with formatting
 * or links only does on a click in empty space, so its links can be clicked and its text selected; a pencil
 * beside it opens the editor too.
 */
export function MarkdownView({ className, label, formatted, onEdit, children }: MarkdownViewProps) {
  if (formatted) {
    return (
      <div className="markdown-field">
        <div
          className={`${className} markdown-view markdown-view-formatted`}
          onClick={(event) => {
            // A drag that selected text was for copying it. Clicks on links never get here.
            if (!window.getSelection()?.isCollapsed) return;
            if (!isOverText(event.clientX, event.clientY)) onEdit();
          }}
        >
          {children}
        </div>
        <button
          type="button"
          className="icon-btn icon-btn-small markdown-edit"
          aria-label={`Edit ${label.toLowerCase()}`}
          title={`Edit ${label.toLowerCase()}`}
          onClick={onEdit}
        >
          <PencilIcon />
        </button>
      </div>
    );
  }
  return (
    <div
      className={`${className} markdown-view`}
      tabIndex={0}
      onFocus={(event) => event.target === event.currentTarget && onEdit()}
    >
      {children || <span className="muted">{label}</span>}
    </div>
  );
}

/**
 * Whether the point is on a character rather than in empty space. The element under it can't tell: a paragraph
 * spans the whole width, past the end of a short line. So this finds the caret position there and checks whether
 * the character on either side of it covers the point.
 */
function isOverText(x: number, y: number): boolean {
  const position = document.caretPositionFromPoint?.(x, y);
  const range = position ? undefined : document.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode ?? range?.startContainer;
  const offset = position?.offset ?? range?.startOffset ?? 0;
  if (!node || node.nodeType !== Node.TEXT_NODE) return false;
  const length = node.textContent?.length ?? 0;
  const character = document.createRange();
  for (const start of [offset - 1, offset]) {
    if (start < 0 || start >= length) continue;
    character.setStart(node, start);
    character.setEnd(node, start + 1);
    for (const rect of character.getClientRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
  }
  return false;
}

export function SidebarItem({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="sidebar-item">
      <div className="sidebar-item-header">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** Only http(s) becomes a link: a calendar object could carry a javascript: URL. */
export function UrlDetail({ url }: { url: string }) {
  return (
    <Detail term="Link">
      {/^https?:\/\//i.test(url) ? (
        <a href={url} target="_blank" rel="noreferrer noopener">
          {url}
        </a>
      ) : (
        url
      )}
    </Detail>
  );
}
