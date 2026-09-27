import { useEffect, useRef, useState } from 'react';
import type { Calendar, CalDavClient, ServerConfig } from '../api/caldav.ts';
import { CloseIcon, HashIcon } from './icons.tsx';

interface Props {
  client: CalDavClient;
  calendar: Calendar;
  feeds: ServerConfig['feeds'];
  onClose: () => void;
}

interface FeedLink {
  title: string;
  description: string;
  url: string;
}

/** The subscription URLs of one list, for Google Calendar's "Other calendars → From URL". */
function feedLinks(client: CalDavClient, calendar: Calendar, feeds: ServerConfig['feeds']): FeedLink[] {
  if (!feeds.token) return [];
  const path = client.relativePath(calendar.href);
  const url = (feed: string) => `${window.location.origin}/feed/${feed}/${feeds.token}/${path}`;
  const links: FeedLink[] = [];
  if (feeds.tasks) {
    links.push({
      title: 'Tasks as events',
      description: 'Each task with a due date shows up as an event on that date.',
      url: url('tasks'),
    });
  }
  if (feeds.events) {
    links.push({
      title: 'Events',
      description: 'The events stored in this calendar, as they are.',
      url: url('events'),
    });
  }
  return links;
}

export function ShareModal({ client, calendar, feeds, onClose }: Props) {
  const links = feedLinks(client, calendar, feeds);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
            In Google Calendar, open <strong>Other calendars → + → From URL</strong> and paste a link.
          </p>

          {links.map((link) => (
            <FeedLinkField key={link.url} link={link} />
          ))}

          <p className="share-note">
            Anyone with a link can see this list, so keep it private. The calendar is read-only, and Google only
            refreshes it every few hours.
          </p>
        </div>
      </div>
    </div>
  );
}

function FeedLinkField({ link }: { link: FeedLink }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
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
      <h3>{link.title}</h3>
      <p className="muted">{link.description}</p>
      <div className="share-link-row">
        <input
          ref={inputRef}
          value={link.url}
          readOnly
          aria-label={`${link.title} link`}
          onFocus={(event) => event.target.select()}
        />
        <button type="button" className="btn btn-primary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
