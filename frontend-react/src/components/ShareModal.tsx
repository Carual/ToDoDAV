import { useEffect, useRef, useState } from 'react';
import type { Calendar, CalDavClient } from '../api/caldav.ts';
import type { Priority } from '../api/tasks.ts';
import { ALL_PRIORITIES, readSetting, saveSetting } from '../viewSettings.ts';
import { CloseIcon, FlagIcon, HashIcon } from './icons.tsx';
import { Select } from './Select.tsx';

interface Props {
  client: CalDavClient;
  calendar: Calendar;
  token: string;
  /** The page sharing it: each starts from what it shows, and remembers its own choices. */
  section?: 'tasks' | 'journal';
  onClose: () => void;
}

/** What the feed's query string asks for (backend/feed/index.ts); the defaults add nothing to the URL. */
interface FeedOptions {
  /** tasks=1: tasks become events. With journals off too, the calendar is sent as stored (and Google ignores its tasks). */
  tasks: boolean;
  /** journals=1: journal entries with a date (VJOURNAL, as jtx Board writes them) become events. */
  journals: boolean;
  /** completed, subtasks and priorities only shape tasks. */
  completed: boolean;
  subtasks: boolean;
  priorities: Priority[];
  html: boolean;
  /** With html: app links (obsidian://) as text and address, since Google Calendar drops them. */
  appLinksAsText: boolean;
  /** Minutes a timed task lasts; 0 is an instant. */
  duration: number;
}

// Each page shares what it shows as events by default (Google Calendar shows nothing of tasks or journal
// entries otherwise), and keeps its own choices, so sharing a journal doesn't change the next task list's link.
const OPTIONS_KEYS = { tasks: 'tododav.feedOptions', journal: 'tododav.journalFeedOptions' } as const;

const TASK_DEFAULTS: FeedOptions = { tasks: true, journals: false, completed: true, subtasks: true, priorities: ALL_PRIORITIES, html: false, appLinksAsText: false, duration: 0 };
const DEFAULTS = { tasks: TASK_DEFAULTS, journal: { ...TASK_DEFAULTS, tasks: false, journals: true } } as const;

const DURATIONS = [
  { value: '0', label: 'No duration' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
];

/** The options last used, so the next list's link comes out the same; anything unreadable falls back to the default. */
function loadOptions(section: 'tasks' | 'journal'): FeedOptions {
  const DEFAULT_OPTIONS = DEFAULTS[section];
  let saved: Partial<Record<keyof FeedOptions, unknown>> = {};
  try {
    saved = JSON.parse(readSetting(OPTIONS_KEYS[section]) ?? '{}') ?? {};
  } catch {
    // Keep the defaults.
  }
  const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const priorities = Array.isArray(saved.priorities) ? ALL_PRIORITIES.filter((p) => (saved.priorities as unknown[]).includes(p)) : [];
  return {
    tasks: bool(saved.tasks, DEFAULT_OPTIONS.tasks),
    journals: bool(saved.journals, DEFAULT_OPTIONS.journals),
    completed: bool(saved.completed, DEFAULT_OPTIONS.completed),
    subtasks: bool(saved.subtasks, DEFAULT_OPTIONS.subtasks),
    priorities: priorities.length > 0 ? priorities : DEFAULT_OPTIONS.priorities,
    html: bool(saved.html, DEFAULT_OPTIONS.html),
    appLinksAsText: bool(saved.appLinksAsText, DEFAULT_OPTIONS.appLinksAsText),
    duration: DURATIONS.some((d) => Number(d.value) === saved.duration) ? (saved.duration as number) : DEFAULT_OPTIONS.duration,
  };
}

/** The list's subscription URL, for Google Calendar's "Other calendars → From URL". */
function feedUrl(client: CalDavClient, calendar: Calendar, token: string, options: FeedOptions): string {
  const url = `${window.location.origin}/feed/${token}/${client.relativePath(calendar.href)}`;
  if (!options.tasks && !options.journals) return url;
  // Built by hand so the priority list keeps its plain commas instead of %2C.
  const params: string[] = [];
  if (options.tasks) {
    params.push('tasks=1');
    if (!options.completed) params.push('completed=0');
    if (!options.subtasks) params.push('subtasks=0');
    if (options.priorities.length < ALL_PRIORITIES.length) params.push(`priority=${options.priorities.join(',')}`);
  }
  if (options.journals) params.push('journals=1');
  if (options.html) params.push('format=html');
  // Remembered while the HTML is off, but only part of the link with it.
  if (options.html && options.appLinksAsText) params.push('applinks=text');
  if (options.duration > 0) params.push(`duration=${options.duration}`);
  return `${url}?${params.join('&')}`;
}

export function ShareModal({ client, calendar, token, section = 'tasks', onClose }: Props) {
  const [options, setOptions] = useState(() => loadOptions(section));
  const url = feedUrl(client, calendar, token, options);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function update(patch: Partial<FeedOptions>) {
    const next = { ...options, ...patch };
    setOptions(next);
    saveSetting(OPTIONS_KEYS[section], JSON.stringify(next));
  }

  function togglePriority(priority: Priority) {
    const priorities = options.priorities.includes(priority)
      ? options.priorities.filter((p) => p !== priority)
      : ALL_PRIORITIES.filter((p) => p === priority || options.priorities.includes(p));
    update({ priorities });
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal modal-small" role="dialog" aria-modal="true" aria-label="Add to Google Calendar">
        <header className="modal-header">
          <span className="modal-crumb">
            <HashIcon style={{ color: calendar.color }} />
            {calendar.name}
          </span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="share-body">
          <h2>Add to Google Calendar</h2>
          <p className="muted">
            In Google Calendar, open <strong>Other calendars → + → From URL</strong> and paste the link.
          </p>

          <div className="share-options">
            <div className="settings-row">
              <label className="switch settings-switch">
                <input type="checkbox" checked={options.tasks} onChange={(e) => update({ tasks: e.target.checked })} />
                <span className="switch-track" aria-hidden="true" />
                Show tasks as events
              </label>
            </div>
            <p className="muted">
              {options.tasks
                ? 'Each task with a due date becomes an event on that date. Events in the list stay as they are.'
                : options.journals
                  ? 'Tasks are left out. Events in the list stay as they are.'
                  : 'The calendar exactly as stored. Google Calendar ignores tasks, so only its events show up.'}
            </p>

            {options.tasks && (
              <div className="share-task-options">
                <div className="settings-row">
                  <label className="switch settings-switch">
                    <input type="checkbox" checked={options.completed} onChange={(e) => update({ completed: e.target.checked })} />
                    <span className="switch-track" aria-hidden="true" />
                    Completed tasks
                  </label>
                </div>
                <div className="settings-row">
                  <label className="switch settings-switch">
                    <input type="checkbox" checked={options.subtasks} onChange={(e) => update({ subtasks: e.target.checked })} />
                    <span className="switch-track" aria-hidden="true" />
                    Sub-tasks
                  </label>
                </div>
                <div className="settings-row">
                  <span className="settings-label" id="share-priority">
                    Priority
                  </span>
                  <div className="priority-toggles" role="group" aria-labelledby="share-priority">
                    {ALL_PRIORITIES.map((p) => {
                      const on = options.priorities.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          className={`priority-toggle p${p}`}
                          aria-pressed={on}
                          // At least one priority stays on: a feed of nothing would only look broken.
                          disabled={on && options.priorities.length === 1}
                          title={`Priority ${p}`}
                          onClick={() => togglePriority(p)}
                        >
                          <FlagIcon />P{p}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="settings-row">
              <label className="switch settings-switch">
                <input type="checkbox" checked={options.journals} onChange={(e) => update({ journals: e.target.checked })} />
                <span className="switch-track" aria-hidden="true" />
                Show journal entries as events
              </label>
            </div>
            <p className="muted">
              Journal entries with a date (jtx Board and similar) become events on that date. Undated notes are left out.
            </p>

            {(options.tasks || options.journals) && (
              <>
                <div className="settings-row">
                  <label className="switch settings-switch">
                    <input type="checkbox" checked={options.html} onChange={(e) => update({ html: e.target.checked })} />
                    <span className="switch-track" aria-hidden="true" />
                    Formatted descriptions
                  </label>
                </div>
                <p className="muted">Bold, italic, links and lists. Google Calendar only: other apps show the HTML tags.</p>
                {options.html && (
                  <div className="share-task-options">
                    <div className="settings-row">
                      <label className="switch settings-switch">
                        <input
                          type="checkbox"
                          checked={options.appLinksAsText}
                          onChange={(e) => update({ appLinksAsText: e.target.checked })}
                        />
                        <span className="switch-track" aria-hidden="true" />
                        Show app link addresses
                      </label>
                    </div>
                    <p className="muted">
                      Google Calendar removes links to apps such as Obsidian. This writes their address as text, so it
                      can be copied.
                    </p>
                  </div>
                )}
                <div className="settings-row">
                  <span className="settings-label">Timed items last</span>
                  <Select
                    className="settings-select"
                    aria-label="Timed items last"
                    value={String(options.duration)}
                    onChange={(duration) => update({ duration: Number(duration) })}
                    options={DURATIONS}
                  />
                </div>
              </>
            )}
          </div>

          <FeedLinkField url={url} />

          <p className="share-note">
            Anyone with the link can see this list, so keep it private. The calendar is read-only, and Google only
            refreshes it every few hours. Changing the options makes a new link: subscribe to it again.
          </p>
        </div>
      </div>
    </div>
  );
}

function FeedLinkField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  // A copied link that has since changed must not still say "Copied".
  useEffect(() => setCopied(false), [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // The Clipboard API only exists on HTTPS/localhost: select the text so Ctrl+C works instead.
      inputRef.current?.select();
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="share-link">
      <h3>Link</h3>
      <div className="share-link-row">
        <input ref={inputRef} value={url} readOnly aria-label="Feed link" onFocus={(event) => event.target.select()} />
        <button type="button" className="btn btn-primary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
