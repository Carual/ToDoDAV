import type { MouseEvent } from 'react';
import { navigate } from '../router.ts';
import { GearIcon, LogoMark } from './icons.tsx';

interface Props {
  section: 'tasks' | 'journal';
  username: string;
  /** Opens the settings; without it, the gear is left out (the settings are about tasks). */
  onSettings?: () => void;
  onLogout: () => void;
}

const SECTIONS = [
  { name: 'tasks', label: 'Tasks', path: '/tasks' },
  { name: 'journal', label: 'Journal', path: '/journal' },
] as const;

/** Real links, so they can be opened in a new tab; a plain click stays in the app. */
function follow(event: MouseEvent<HTMLAnchorElement>, path: string) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(path);
}

export function TopBar({ section, username, onSettings, onLogout }: Props) {
  return (
    <header className="topbar">
      <div className="topbar-start">
        <div className="brand brand-small">
          <LogoMark className="brand-mark" />
          <span className="brand-name">ToDoDAV</span>
        </div>
        <nav className="nav-tabs" aria-label="Sections">
          {SECTIONS.map(({ name, label, path }) => (
            <a
              key={name}
              href={path}
              className="nav-tab"
              aria-current={section === name ? 'page' : undefined}
              onClick={(event) => follow(event, path)}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
      <div className="account">
        {onSettings && (
          <button type="button" className="icon-btn" aria-label="Settings" title="Settings" onClick={onSettings}>
            <GearIcon />
          </button>
        )}
        <span className="avatar" aria-hidden="true">
          {username.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-name">{username}</span>
        <button type="button" className="btn btn-link" onClick={onLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}
