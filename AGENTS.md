# AGENTS.md

Guide for coding agents and contributors working on ToDoDAV. The user-facing overview is in [README.md](README.md); this file holds the architecture, design decisions and conventions.

## What this is

A self-hosted, Todoist-style task manager on top of any CalDAV server (built and tested against Radicale). Tasks are stored as iCalendar `VTODO`s on the user's CalDAV server; ToDoDAV itself stores nothing.

```
browser (frontend: all the logic)  ──►  backend: /proxy/*  ──►  your CalDAV server
                                        credential check         (CALDAV_URL in env)
```

- **`frontend-react/`**: the Todoist-style web app (React + Vite). It speaks CalDAV itself (PROPFIND, REPORT, PUT...) against `/proxy/...`.
- **`backend/`**: a minimal Express proxy that also serves the built app. It exists only because browsers cannot talk to most CalDAV servers directly (CORS, auth prompts, mixed hosts). It stores nothing.

The tooling (`package.json`, `tsconfig.json`, `.env`) lives at the repository root. npm manages dependencies. Bun is the primary runtime, and Node works too. Both run the TypeScript directly, with no build step for the backend.

### Repository layout

```
backend/
  index.ts        Express app: status check, HTTPS guard, /api/config, /proxy, /feed, the built app
  auth.ts         Basic-auth credential check (constant-time, delayed 401); feed token and path check
  config.ts       Reads and validates env; fails fast listing every problem
  feed/
    tasks.ts      /feed/tasks: a task list as a calendar of events (VTODO -> VEVENT, ical.js)
    events.ts     /feed/events: a calendar passed through as-is (http-proxy-middleware)
frontend-react/
  src/api/caldav.ts   CalDAV client (plain fetch + DOMParser)
  src/api/tasks.ts    VTODO <-> Task model conversion (ical.js)
  src/components/     Login, MainPage, TaskItem, TaskModal, ShareModal, ConfirmDialog, icons
  src/format.ts       Due-date labels and date formatting
  src/router.ts       Tiny History-API router: /login, /tasks, /tasks/<uid>
  vite.config.ts      Dev server proxies /proxy, /api and /feed to the backend; build goes to dist/frontend-react/
.env.example      Documented configuration
```

## Backend

Everything under `/proxy` is forwarded to `CALDAV_URL`. For example, `PROPFIND /proxy/juan/tasks/` becomes `PROPFIND <CALDAV_URL>juan/tasks/`. The request's method, headers and body are sent as-is (including `Authorization`), and the CalDAV server decides what is allowed.

`GET /api/status` is a status check that answers `{"status":"ok"}`, even over plain HTTP, so a fresh install can be checked from anywhere. It reveals nothing else. ToDoDAV listens on `0.0.0.0` by default.

For `/proxy`, the backend does only five things:

1. **HTTPS only in production.** When `NODE_ENV=production`, `/proxy` requests that did not arrive over HTTPS get `403`, and `CALDAV_URL` must be `https://`. ToDoDAV itself speaks plain HTTP behind a TLS reverse proxy (Caddy, Traefik, nginx/openresty), which must *overwrite* `X-Forwarded-Proto` (nginx/openresty: `proxy_set_header X-Forwarded-Proto $scheme;`). The header is only trusted from loopback and private-network addresses (`trust proxy` = `loopback, linklocal, uniquelocal`), so a client reaching the port directly from the internet cannot fake it.
2. **Credential check.** The `Authorization: Basic ...` header must match `CALDAV_USERNAME` / `CALDAV_PASSWORD`. Otherwise it answers `401` after a 1-second delay, which slows down password guessing, and the CalDAV server is never contacted. Both sides are SHA-256 hashed before `timingSafeEqual`, so response time reveals nothing about the expected values.
3. **Fixed host.** Requests always go to the host in `CALDAV_URL`. The client only chooses the path.
4. **MOVE destination.** The client sends the destination as an app URL (`https://app/proxy/juan/work/a.ics`), and the backend rewrites it to the CalDAV server's path (`/juan/work/a.ics`). The path has no host (allowed by RFC 4918) because, behind a reverse proxy, CalDAV servers often cannot recognize their own public host and reject the MOVE.
5. **No login popup.** The `WWW-Authenticate` header is removed from responses, and the backend's own `401` never sends one, so the browser never shows its native login prompt.

Security headers come from `helmet`, and the proxying itself from `http-proxy-middleware`.

`GET /api/config` tells the frontend what this install offers: `{"feeds":{"tasks":true,"events":false,"token":"..."}}` (`token` only when a feed is on). It has the same HTTPS and credential checks as `/proxy`, because it reveals the feed token, and is sent with `Cache-Control: no-store`. Keep it to settings the frontend needs; never the CalDAV credentials.

**The built app.** The backend serves `dist/frontend-react/` (`npm run build`) with `express.static`, so one process and one origin cover everything and the reverse proxy only terminates TLS. Any other `GET` gets `index.html` (the client-side routes). The app is HTTPS-only in production like `/proxy`, because a login page served over plain HTTP would send the password in the clear before `/proxy` could refuse it. Serving `dist/frontend-react/` from the reverse proxy instead still works: it forwards `/proxy/*`, `/api/*` and `/feed/*` and answers other non-file paths with `index.html` (Caddy `try_files {path} /index.html`, nginx `try_files $uri /index.html`).

### Feeds (`/feed`)

The one exception to "all logic lives in the browser". Google Calendar can subscribe to an `.ics` URL, but it fetches from Google's servers, cannot log in to CalDAV and ignores `VTODO`s. So the backend publishes read-only feeds, reading the CalDAV server with the credentials from env. Each feed is **off by default** (`FEED_TASKS_ENABLED`, `FEED_EVENTS_ENABLED`).

- **Access.** `FEED_TOKEN` is required whenever a feed is enabled (startup fails without it). It is the first path segment (`/feed/tasks/<token>/juan/tasks/`), compared in constant time. A wrong token answers `404` after 1 second, so scanners cannot tell a feed exists. Dot segments (also percent-encoded ones) are refused, since the caller never proved it knows the password. Only `GET`/`HEAD`, and HTTPS in production like `/proxy`.
- **`/feed/events/<path>`** is a plain proxy: `GET <CALDAV_URL><path>` with the env credentials. It relies on Radicale answering `GET` on a calendar collection with the whole calendar (not standard CalDAV). Only a `200 text/calendar` (or `304`) goes back, with just `Content-Type`, `Content-Length`, `ETag`, `Last-Modified` and `Content-Disposition` (Radicale names the file after the calendar; without one, the last path segment is used); anything else becomes `404`, so address books and other data on the same account never leave through it.
- **`/feed/tasks/<path>`** reads one calendar (`PROPFIND` depth 0 must say it is a calendar, else `404`; then a `REPORT` for `VTODO`s) and converts each task. There is no `DOMParser` on the server, so `calendar-data`, `resourcetype` and `displayname` are pulled out with a prefix-agnostic regex instead of adding an XML dependency. The translation rules (in `toEvent`):

  | Task | Event |
  | --- | --- |
  | No due date (`DUE`, or `DTSTART` + `DURATION`) | Left out |
  | Cancelled | Left out (an override of a repeating task stays as a cancelled occurrence) |
  | Completed | Kept, title prefixed with `✓ ` |
  | `DTSTART` before `DUE`, same value type | Spans start → due |
  | Otherwise | On the due date only |
  | Timed | An instant: `DTEND` = `DTSTART` |
  | All-day | `DTEND` is the next day (exclusive) |
  | `RRULE`, `RDATE`, `EXDATE`, `RECURRENCE-ID`, `VALARM` | Kept |
  | `DESCRIPTION`, `LOCATION`, `URL`, `UID`, `SEQUENCE`... | Kept |
  | `PRIORITY`, `CATEGORIES`, `X-` properties | Dropped; the title is just the task name |

  Every event is `TRANSP:TRANSPARENT` (free, never blocks time). `X-WR-CALNAME` carries the list's display name, and so does the file name (`Content-Disposition: attachment; filename="<name>.ics"`). Times keep their `TZID`, and the needed `VTIMEZONE`s are copied once.

Google refreshes subscribed calendars on its own schedule (often 8–24 hours) and the feeds are one-way: nothing done in Google comes back.

### Configuration

See [.env.example](.env.example). `config.ts` validates everything at startup and throws one error listing every problem:

| Variable | Rules |
| --- | --- |
| `NODE_ENV` | `production` enables the HTTPS-only rules. Anything else (or unset) is development mode. |
| `CALDAV_URL` | Required. `http`/`https` (`https` only in production). No credentials, query string or fragment. A trailing `/` is added if missing. |
| `CALDAV_USERNAME` | Required. Must not contain `:` (Basic auth separator). |
| `CALDAV_PASSWORD` | Required. |
| `HOST` | Default `0.0.0.0`. Use `127.0.0.1` when the reverse proxy is on the same machine. |
| `PORT` | Default `3000`. Also read by the Vite dev server so `/proxy` stays in sync. |
| `FEED_TASKS_ENABLED` | `true` or `false` (default). Mounts `/feed/tasks`. |
| `FEED_EVENTS_ENABLED` | `true` or `false` (default). Mounts `/feed/events`. |
| `FEED_TOKEN` | Required when a feed is enabled. At least 32 characters of `A-Z a-z 0-9 - _`. |

## Frontend (`frontend-react/`)

A React + Vite app that looks and behaves like Todoist:

- **Routes:** `/login`, `/tasks`, and `/tasks/<uid>`, which is the tasks page with that task's modal open. The router is `src/router.ts` (History API + `useSyncExternalStore`, no dependency). Without a session every path redirects to `/login`, remembering a `/tasks...` path to return to after logging in. With a session, anything that isn't `/tasks...` redirects to `/tasks`. Redirects use `replaceState`, so Back never lands on one. The UID is percent-encoded in the path because UIDs are free text. If the UID isn't in the current list, the other lists are searched and the app switches to the one holding it. Otherwise it shows "Task not found" and goes back to `/tasks`.
- **Login:** asks the server for your task lists (a CalDAV PROPFIND), which only works with the right username and password. The credentials stay in `sessionStorage`, so they survive a reload but disappear when the tab closes.
- **Main page:** the current list's name as the title, with a selector when there is more than one list (only calendars that support `VTODO` are shown). Open tasks are sorted by due date, then by priority.
- **Task rows:** a round checkbox colored by priority completes the task (with Undo). Rows show the description, a color-coded due date and labels, plus an edit button on hover.
- **Add task:** the "+ Add task" row under the list (or the **Q** key) opens the same modal empty; its footer button says "Add task". New tasks get a random UID and are written with `If-None-Match: *`, so they can never overwrite an existing one.
- **Task modal:** shows everything about the task and lets you edit the title, description, an optional start date, the due date, priority and labels. An "All day" switch covers both dates: on means date only, off means date and time (iCalendar requires `DTSTART` and `DUE` to be the same type). Save and Cancel sit in the footer, and Ctrl/⌘+Enter saves. With unsaved changes, every way out shows an in-app "Discard unsaved changes?" dialog (`ConfirmDialog`, never `window.confirm`): ×, Cancel, Escape, clicking outside, and the browser's Back/Forward. For Back/Forward, `useLeaveGuard` in `router.ts` undoes the move at once with `history.go()` (each history entry stores its index), waits for the dialog, and replays the move on Discard. Reloading or closing the tab can only get the browser's own prompt. The task's UID is shown in small print at the bottom of the sidebar. Opening a task pushes `/tasks/<uid>`, and closing, saving or completing it pushes `/tasks`.
- **Share button:** next to the list selector, only when `/api/config` reports a feed. It opens a modal with the current list's feed links (`<origin>/feed/<tasks|events>/<token>/<list path>`) and a Copy button each, for Google Calendar's "From URL". `/api/config` is fetched at login; if it fails, the login still works and the button stays hidden.

`src/api/caldav.ts` is the CalDAV client (plain `fetch` + `DOMParser`), and `src/api/tasks.ts` converts between iCalendar `VTODO` and the task model using `ical.js`.

### Design decisions

- **All logic lives in the browser.** The backend is a dumb, stateless proxy; features are built in the frontend against standard CalDAV.
- **Preserve what other apps wrote.** Edits go through `applyEdits`, which only touches the fields the modal owns. Reminders (`VALARM`), repeat rules (`RRULE`) and any unknown properties set by other CalDAV clients are kept.
- **Optimistic concurrency with ETags.** Updates send `If-Match` with the task's ETag. If the task changed elsewhere in the meantime, the server refuses the save and the list reloads instead of overwriting.
- **Never clobber on create.** New tasks use `If-None-Match: *`.
- **Same origin in dev and prod.** Vite's dev server proxies `/proxy`, `/api` and `/feed` to the backend, mirroring the production reverse proxy, so the frontend always calls relative URLs (and feed links built from `window.location.origin` work in dev too).

### Not implemented yet

Deleting tasks and moving tasks between lists are not in the UI yet (the backend already supports `MOVE`).

## Development

Requires Bun ≥ 1.4 (older Bun versions lowercase methods such as `PROPFIND`, which breaks CalDAV) or Node ≥ 22.18.

```sh
npm install
cp .env.example .env    # then edit it
npm run dev             # backend + frontend with concurrently; if one crashes, the other stops too
npm run typecheck       # backend and frontend
```

Or separately, in two terminals:

```sh
npm run dev:backend     # the proxy on :3000 (Bun, reads .env, restarts on changes)
npm run dev:frontend    # the app on http://localhost:5173, forwarding /proxy to the backend
```

Each Bun script has a Node equivalent: `npm run dev:backend:node` and `npm run start:node`. `npm run build` typechecks and builds the app into `dist/frontend-react/` (`npm run build:frontend` skips the typecheck), and `npm run start` then serves the app and backend on Bun without watching.

Run `npm run typecheck` after changes; there is no test suite yet.

## Conventions

- TypeScript everywhere, ES modules, imports with explicit `.ts` extensions in the backend.
- Comments explain *why* (protocol quirks, security reasons), not what the code does. Keep that style.
- Keep the backend minimal. New behavior belongs in the frontend unless it is impossible there (e.g. something the browser cannot do for security reasons).
- Keep dependencies few. The CalDAV client is hand-written on `fetch` + `DOMParser` on purpose.
- Never commit `.env`.

## Security notes

- **Run with `NODE_ENV=production` when deploying.** If it's missing, ToDoDAV runs in development mode and accepts plain HTTP. Basic auth sends the password with every request, so development mode must never face the internet.
- **Use a dedicated or app-specific password** for ToDoDAV.
- **The path in `CALDAV_URL` is not a boundary.** A client could use `..` to reach other paths on the same CalDAV host, always with these same credentials. The CalDAV server's own permissions still apply. (The feeds refuse `..`, because their callers have no password.)
- **The feed token is the only lock on the feeds.** Anyone with the URL can read every calendar those credentials can read, through that feed. Keep it secret, and change `FEED_TOKEN` to revoke old URLs.
- **Keep the password out of `localStorage`.** The frontend has to keep it in the browser in order to send it, so prefer memory or `sessionStorage`. Any XSS would expose it.
