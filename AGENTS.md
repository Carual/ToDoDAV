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
  src/api/icsFile.ts  A list as one .ics file, and an .ics file as one calendar object per task
  src/api/todoist.ts  Todoist CSV <-> tasks (csv.ts reads and writes CSV; todoistDates.ts reads/writes Todoist dates)
  src/useTaskList.ts  Task state per list, with optimistic changes and queued saves
  src/taskTree.ts     Sub-task nesting from RELATED-TO (loop-safe), with descendants/ancestors
  src/components/     Login, MainPage, TaskItem, TaskModal, RepeatField, ShareModal, SettingsModal, ImportExportModal, FilterModal, ConfirmDialog, Spinner, icons,
                      and the form controls: Select, DatePicker, TimeField (all opening in a Popover)
  src/viewSettings.ts Filters and task-row details (saved in localStorage), and the filter matching
  src/download.ts     Saving text as a file in the browser, with a safe file name
  src/format.ts       Due-date labels, date formatting, and repeat rules in words
  src/repeat.ts       Repeat choices and the custom form <-> RRULE, moving a rule with its date, first occurrence
  src/router.ts       Tiny History-API router: /login, /tasks, /tasks/<uid>
  vite.config.ts      Dev server proxies /proxy, /api and /feed to the backend; build goes to dist/frontend-react/
.env.example          Documented configuration
Dockerfile            Builds with npm (node image), runs on Bun with only the production dependencies
docker-compose.yaml   Example stack: container `tododav` on port 3852 (all addresses)
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

Security headers come from `helmet` (default CSP, plus `frame-src https://www.google.com` for the task modal's map), and the proxying itself from `http-proxy-middleware`.

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
  | Completed | Kept, title prefixed with `✓ `, without `RRULE`/`RDATE`/`EXDATE` (done once, not on every future date) |
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
| `PORT` | Default `3852`. Also read by the Vite dev server so `/proxy` stays in sync. |
| `FEED_TASKS_ENABLED` | `true` or `false` (default). Mounts `/feed/tasks`. |
| `FEED_EVENTS_ENABLED` | `true` or `false` (default). Mounts `/feed/events`. |
| `FEED_TOKEN` | Required when a feed is enabled. At least 32 characters of `A-Z a-z 0-9 - _`. |

## Frontend (`frontend-react/`)

A React + Vite app that looks and behaves like Todoist:

- **Routes:** `/login`, `/tasks`, and `/tasks/<uid>`, which is the tasks page with that task's modal open. The router is `src/router.ts` (History API + `useSyncExternalStore`, no dependency). Without a session every path redirects to `/login`, remembering a `/tasks...` path to return to after logging in. With a session, anything that isn't `/tasks...` redirects to `/tasks`. Redirects use `replaceState`, so Back never lands on one. The UID is percent-encoded in the path because UIDs are free text. If the UID isn't in the current list, the other lists are searched and the app switches to the one holding it. Otherwise it shows "Task not found" and goes back to `/tasks`.
- **Login:** asks the server for your task lists (a CalDAV PROPFIND), which only works with the right username and password. The credentials stay in `sessionStorage`, so they survive a reload but disappear when the tab closes.
- **Main page:** the current list's name as the title, with a selector when there is more than one list (only calendars that support `VTODO` are shown). Open tasks are sorted by due date, then by priority.
- **Task rows:** a round checkbox colored by priority completes the task (with Undo; a repeating task moves to its next date instead), plus an edit button on hover. Under the title, rows show the details chosen in Settings, in the chosen order. By default: the description, then the sub-task count, the color-coded due date and the labels on one line, then the location. Description and location always take a line of their own; the small details (sub-tasks, start date, due date, labels) share a line when they are next to each other.
- **Repeating tasks:** a task repeats when it has an `RRULE`, which counts from `DTSTART`, or from `DUE` when there is no start (as Tasks.org and Thunderbird read it). Rows show a repeat icon after the due date (after the start date when there is no due date), with the rule in words on hover (`describeRepeat` in `src/format.ts`: "Every other Friday", "Every month on the 2nd Tuesday, 5 times"...; rules too intricate for that read "..., custom rule").
  - **Setting a repeat** (`RepeatField`, logic in `src/repeat.ts`): a "Repeat" switch under the dates in the task modal. Switching it on picks every day and shows a select with Google Calendar's choices for the task's date: every day, every weekday, every week on its weekday, every month on its day, on its nth weekday (1st–4th) or its last one, every year, and Custom…. Custom opens a form: every N days/weeks/months/years, weekday buttons (Monday first; at least one stays on), which day of the month, and ends never, on a date or after N times; the rule in words sits under it. A rule from another app that no choice matches is listed as itself and stays untouched until another choice is picked.
  - **Rules follow their date.** What the date already says is left out of the rule (`FREQ=MONTHLY` is monthly on the date's day, as RFC 5545 reads it), and changing the date moves a rule the form can show to the new date ("every week on Friday" becomes Monday's, `BYDAY=1FR` becomes `1MO`), as Google Calendar does. Choosing a repeat for a task without a date sets the due date to today, and a rule that doesn't include the date (every Monday, chosen on a Friday) moves the dates to its first occurrence, as Todoist does. `UNTIL` takes the dates' type (a date for all-day tasks, the end of that day in UTC for timed ones), also when "All day" is switched; an end before the task's date is refused.
  - **Saving.** An unchanged rule is written back exactly as it was. Switching "Repeat" off, or removing both dates (the modal warns), removes `RRULE`, `RDATE` and `EXDATE`, and with them any overrides of single occurrences (`RECURRENCE-ID`) in the same file. Since the file can hold such overrides, `parseTask` and the edits always work on the main `VTODO`, the one without `RECURRENCE-ID`.
  - **Completing.** Ticking a repeating task (in the list or the modal) doesn't complete it: `withNextOccurrence` moves it to its next occurrence and leaves it open, as Todoist, Tasks.org and Thunderbird do (one `VTODO` that moves along, no copy per occurrence). The next occurrence is the first after the current one *and* after today, so an overdue task comes back once, in the future. `DTSTART` and `DUE` move by the same number of days on the clock the task is shown in (09:00 stays 09:00 across DST; `TZID` and floating times move in their own zone, UTC ones in the browser's); hourly and shorter rules move by exact time instead. `EXDATE`s are skipped, `COUNT` goes down by the occurrences used up, and when `COUNT` or `UNTIL` leaves nothing, the task is completed for good. `RDATE`s are ignored here: moving `DTSTART` onto one would shift what the rule leaves implicit. The completed sub-tasks of a repeating task open again for the next time (Todoist's checklist behavior), open ones are left alone. The toast says the next date ("Task completed. Next: Tomorrow"), and Undo puts back the previous content as a new revision (`restoredTo`, higher `SEQUENCE`) and re-completes those sub-tasks.
  - **Complete for good.** For an open repeating task, the modal's footer has a small "Complete for good" button: the task is marked completed as usual and keeps its `RRULE`, so reopening it from the Completed section brings the repeat back. The feed leaves the repeat out of completed tasks.
- **Settings:** a gear button left of the avatar opens `SettingsModal`. Settings and filters apply at once and are saved together in `localStorage` (`tododav.view`, read by `loadSettings`, which drops unknown values and adds details introduced later). The modal has three parts. **List:** whether sub-tasks are nested under their parent (default) or every open task is listed at the top level, sorted like any other (no chevrons; rows still show their sub-task count), and whether tasks without a due date go at the end (default) or at the top. The same order is used for the sub-tasks in the task modal. **Task page:** whether the task modal shows a map of the location (off by default, since the frame sends the location and the user's Google cookies to Google). **Task details:** a switch per detail, with up/down buttons to reorder them. "Reset to defaults" restores all of these but leaves the filters alone. At the bottom, an **Import and export** part opens `ImportExportModal` (see below).
- **Filters:** a funnel button right of the list title opens `FilterModal` (the button is tinted while any filter is on). Filters: priorities (at least one stays on), due date (overdue, today and overdue, next 7 days and overdue, with or without a date) and a label from the current list. They apply to open and completed tasks. When the filters leave a task out, its matching open sub-tasks take its place in the tree. While any filter is on, a bar above the list says which ones (clicking it opens the modal), with Clear.
- **Sub-tasks:** a task's parent is its `RELATED-TO` with `RELTYPE=PARENT` or no `RELTYPE` (the RFC 5545 default); `CHILD`/`SIBLING` links are ignored. Open sub-tasks are listed indented under their open parent, sorted like the top level, and a chevron in the left gutter hides them (in memory only). An open sub-task whose parent is completed, missing or in another list shows at the top level. Loops written by other clients (A under B under A) are broken by showing the looping tasks at the top level (`buildTree` in `src/taskTree.ts`). Rows with sub-tasks show a done/total count. Completing a task also completes its open sub-tasks at any depth, and Undo reopens exactly those. Reopening a sub-task reopens its completed parents. The task modal lists the direct sub-tasks (open first, then completed) with their own checkboxes, opens one when it is clicked, and has an "Add sub-task" field that stays open for the next name (Escape closes only the field). New sub-tasks are written with `RELATED-TO;RELTYPE=PARENT:<parent uid>`. A sub-task's modal shows its parent in the header breadcrumb, which opens it. Moving to another task from the modal asks before discarding unsaved changes, including a typed sub-task name that hasn't been added.
- **Completed tasks:** a collapsible "Completed" section under the list (only when the list has any), most recently completed first, struck through. Its filled checkbox reopens the task. Whether it is expanded is remembered in `localStorage`, like the selected list.
- **Add task:** the "+ Add task" row under the list (or the **Q** key) opens the same modal empty; its footer button says "Add task". New tasks get a random UID and are written with `If-None-Match: *`, so they can never overwrite an existing one.
- **Task modal:** shows everything about the task and lets you edit the title, description, an optional start date, the due date, priority (four flags in their colors, the chosen one framed), labels and location. The location is free text (`LOCATION`); once it has any, a pin button opens it in Google Maps in a new tab (a keyless Maps URL, so nothing is sent to Google until it is clicked). When the "Show a map of the location" setting is on (off by default), the modal also shows it in an iframe (`https://www.google.com/maps?q=...&output=embed`, keyless but undocumented, reloaded once typing pauses); the backend's CSP allows `frame-src https://www.google.com` for it and nothing else. Changing the location also removes `GEO` and `X-APPLE-STRUCTURED-LOCATION`, whose coordinates belonged to the old text. Only the due date shows by default: a "Start date" switch, right of "All day", shows the start date's field (on when the task has one), and switching it off removes the start date. An "All day" switch covers both dates: on means date only, off means date and time (iCalendar requires `DTSTART` and `DUE` to be the same type). Save and Cancel sit in the footer, and Ctrl/⌘+Enter saves. With unsaved changes, every way out shows an in-app "Save changes?" dialog (`ConfirmDialog`, never `window.confirm`): ×, Cancel, Escape, clicking outside, and the browser's Back/Forward. It offers Cancel (stay), Discard, and Save, the focused default, which also adds a typed sub-task name; when the edits can't be saved (no name, start after due...), Save is disabled, the dialog says why and Cancel takes the focus. The dialog does the saving itself, so `onSave` never navigates and each way out only learns whether to go on. For Back/Forward, `useLeaveGuard` in `router.ts` undoes the move at once with `history.go()` (each history entry stores its index), waits for the dialog, and replays the move on Save or Discard. Reloading or closing the tab can only get the browser's own prompt. The task's UID is shown in small print at the bottom of the sidebar. A small download button left of Cancel saves the task as an `.ics` file, exactly as stored (overrides of a repeating task included, unsaved edits not). Opening a task pushes `/tasks/<uid>`, and closing, saving or completing it pushes `/tasks`.
- **Import and export:** an "Import or export" button in Settings replaces it with `ImportExportModal`, which works on one list (the one on screen by default) in one of two formats, remembered in `localStorage` (`tododav.transferFormat`). Everything runs in the browser: exports fetch the list and download a file (a `Blob` link); imports read the file and `PUT` each task with `If-None-Match: *`, four at a time, then refresh the list. The modal can't be closed while an import runs.
  - **iCalendar (.ics):** the export is one `VCALENDAR` with every `VTODO` exactly as stored (overrides of repeating tasks included), each used `VTIMEZONE` once, and `X-WR-CALNAME`; completed tasks are optional. The import splits a file into one calendar object per UID, with the time zones it refers to. UIDs are kept (so `RELATED-TO` still works), and tasks whose UID is already in the list are skipped, so importing twice adds nothing. Events and other components are left out with a note.
  - **Todoist (CSV):** follows [Todoist's CSV format](https://www.todoist.com/help/articles/import-or-export-a-project-as-a-csv-file-in-todoist-YC8YvN) and its template: the `TYPE,CONTENT,...,DEADLINE_LANG` header, a `meta,view_style=list` row and a blank row. The export has the open tasks only (Todoist can't import completed ones), in list order with sub-tasks by `INDENT` (1–4, deeper ones go to 4). Labels go in `CONTENT` as `@label` (spaces become `_`). `PRIORITY` is always written, because Todoist reads an empty one as p1. `DATE` is ISO (`2025-03-31 at 11:00`), or Todoist's words for a repeat (`every Friday`, `every 13th`, `every 2nd Tuesday`, `every Mar 31`...); like Todoist's own export it drops when the repeat started, and a repeat Todoist can't express (COUNT, UNTIL, complex BY parts) exports its next date only, with a warning. A timed start earlier on the due day becomes `DATE` = start plus `DURATION` in minutes. Location and URL go in `note` rows (comments), a location as `Location: ...`. It warns above Todoist's 300-task limit. The import finds columns by header name (older exports have fewer), reads `DATE` as English or Spanish free text (`today at 11:00`, `every month @ 13:00`, `cada viernes a las 9`...; `todoistDates.ts`) into a due date and an `RRULE`, turns `DURATION` into start + due, uses `DEADLINE` as the due date only when there is no `DATE` (otherwise it goes in the description), nests by `INDENT`, adds `note` rows to the task's description (a `Location: ` note sets the location), gives tasks under a `section` the section name as a label, and treats an empty `PRIORITY` as p1, as Todoist does. Dates it can't read are kept in the description as `Todoist date: ...`. `AUTHOR`, `RESPONSIBLE` and `TIMEZONE` are ignored (times are local).
- **Form controls:** no native `<select>`, date or time inputs, whose popups look like the browser rather than the app. `Select` is a dropdown built as the ARIA select-only combobox (the focus stays on the button; arrows, Home/End, type-ahead). `DatePicker` opens Todoist's scheduler: Today, Tomorrow, This/Next weekend, Next week and (optionally) No date, then a month calendar starting on Monday (arrow keys move by day and week, Page Up/Down by month, Tab goes round inside it); it takes a `min` date. `TimeField` is a box that takes typed times ("9", "930", "9:30 pm", "21h"...) with a half-hour list under it. They all open in `Popover`, which renders in `<body>` (so a modal's scrolling area can't clip it), flips above the control when there is more room there, and closes on Escape or a click outside without that click also reaching the modal behind. Don't wrap these controls in a `<label>`; give them an `aria-label`.
- **Share button:** next to the list selector, only when `/api/config` reports a feed. It opens a modal with the current list's feed links (`<origin>/feed/<tasks|events>/<token>/<list path>`) and a Copy button each, for Google Calendar's "From URL". `/api/config` is fetched at login; if it fails, the login still works and the button stays hidden.

`src/api/caldav.ts` is the CalDAV client (plain `fetch` + `DOMParser`), and `src/api/tasks.ts` converts between iCalendar `VTODO` and the task model using `ical.js`.

### Design decisions

- **All logic lives in the browser.** The backend is a dumb, stateless proxy; features are built in the frontend against standard CalDAV.
- **Preserve what other apps wrote.** Edits go through `applyEdits`, which only touches the fields the modal owns. Reminders (`VALARM`), repeat rules (`RRULE`) and any unknown properties set by other CalDAV clients are kept.
- **Optimistic updates.** Completing, reopening, editing and adding a task show at once, and the modal closes without waiting; the save runs in the background (`useTaskList`). Saves to one task are queued, each sending the ETag the previous one got back, so quick successive changes (edit, complete, Undo) never conflict with each other. If a save fails, the task goes back to what the server last confirmed (a new task disappears) and a toast says why. When the server could not be reached, the toast offers Retry. When the server refused, the list reloads instead. Lists already seen stay in memory, so switching lists shows them at once while a fresh copy loads, and a reload keeps the local version of tasks whose save is still in flight.
- **Optimistic concurrency with ETags.** Updates send `If-Match` with the task's ETag. If the task changed elsewhere in the meantime, the server refuses the save and the list reloads instead of overwriting.
- **Never clobber on create.** New tasks use `If-None-Match: *`.
- **Same origin in dev and prod.** Vite's dev server proxies `/proxy`, `/api` and `/feed` to the backend, mirroring the production reverse proxy, so the frontend always calls relative URLs (and feed links built from `window.location.origin` work in dev too).

### Not implemented yet

Deleting tasks and moving tasks between lists are not in the UI yet (the backend already supports `MOVE`). Neither is changing an existing task's parent (indenting or outdenting it, or dragging it under another task). Neither is "repeat from the completion date" (Todoist's `every!`), which iCalendar has no standard property for.

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
npm run dev:backend     # the proxy on :3852 (Bun, reads .env, restarts on changes)
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
