# AGENTS.md

Guide for coding agents and contributors working on ToDoDAV. The user-facing overview is in [README.md](README.md); this file holds the architecture, design decisions and conventions.

## What this is

A self-hosted, Todoist-style task manager on top of any CalDAV server (built and tested against Radicale). Tasks are stored as iCalendar `VTODO`s on the user's CalDAV server; ToDoDAV itself stores nothing.

```
browser (frontend: all the logic)  ──►  backend: /proxy/*  ──►  your CalDAV server
                                        credential check         (CALDAV_URL in env)
```

- **`frontend-react/`**: the Todoist-style web app (React + Vite). It speaks CalDAV itself (PROPFIND, REPORT, PUT...) against `/proxy/...`.
- **`backend/`**: a minimal Express proxy. It exists only because browsers cannot talk to most CalDAV servers directly (CORS, auth prompts, mixed hosts). It stores nothing.

The tooling (`package.json`, `tsconfig.json`, `.env`) lives at the repository root. npm manages dependencies. Bun is the primary runtime, and Node works too. Both run the TypeScript directly, with no build step for the backend.

### Repository layout

```
backend/
  index.ts        Express app: status check, HTTPS guard, /proxy
  auth.ts         Basic-auth credential check (constant-time, delayed 401)
  config.ts       Reads and validates env; fails fast listing every problem
frontend-react/
  src/api/caldav.ts   CalDAV client (plain fetch + DOMParser)
  src/api/tasks.ts    VTODO <-> Task model conversion (ical.js)
  src/components/     Login, MainPage, TaskItem, TaskModal, icons
  src/format.ts       Due-date labels and date formatting
  vite.config.ts      Dev server proxies /proxy to the backend; build goes to dist/frontend-react/
.env.example      Documented configuration
```

## Backend

Everything under `/proxy` is forwarded to `CALDAV_URL`. For example, `PROPFIND /proxy/juan/tasks/` becomes `PROPFIND <CALDAV_URL>juan/tasks/`. The request's method, headers and body are sent as-is (including `Authorization`), and the CalDAV server decides what is allowed.

`GET /` is a status check that answers `{"status":"ok"}`, even over plain HTTP, so a fresh install can be checked from anywhere. It reveals nothing else. ToDoDAV listens on `0.0.0.0` by default.

For `/proxy`, the backend does only five things:

1. **HTTPS only in production.** When `NODE_ENV=production`, `/proxy` requests that did not arrive over HTTPS get `403`, and `CALDAV_URL` must be `https://`. ToDoDAV itself speaks plain HTTP behind a TLS reverse proxy (Caddy, Traefik, nginx/openresty), which must *overwrite* `X-Forwarded-Proto` (nginx/openresty: `proxy_set_header X-Forwarded-Proto $scheme;`). The header is only trusted from loopback and private-network addresses (`trust proxy` = `loopback, linklocal, uniquelocal`), so a client reaching the port directly from the internet cannot fake it.
2. **Credential check.** The `Authorization: Basic ...` header must match `CALDAV_USERNAME` / `CALDAV_PASSWORD`. Otherwise it answers `401` after a 1-second delay, which slows down password guessing, and the CalDAV server is never contacted. Both sides are SHA-256 hashed before `timingSafeEqual`, so response time reveals nothing about the expected values.
3. **Fixed host.** Requests always go to the host in `CALDAV_URL`. The client only chooses the path.
4. **MOVE destination.** The client sends the destination as an app URL (`https://app/proxy/juan/work/a.ics`), and the backend rewrites it to the CalDAV server's path (`/juan/work/a.ics`). The path has no host (allowed by RFC 4918) because, behind a reverse proxy, CalDAV servers often cannot recognize their own public host and reject the MOVE.
5. **No login popup.** The `WWW-Authenticate` header is removed from responses, and the backend's own `401` never sends one, so the browser never shows its native login prompt.

Security headers come from `helmet`, and the proxying itself from `http-proxy-middleware`.

The backend does **not** serve the built frontend. In production, the reverse proxy serves `dist/frontend-react/` as static files and forwards `/proxy/*` to the backend, so both share one origin.

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

## Frontend (`frontend-react/`)

A React + Vite app that looks and behaves like Todoist:

- **Login:** asks the server for your task lists (a CalDAV PROPFIND), which only works with the right username and password. The credentials stay in `sessionStorage`, so they survive a reload but disappear when the tab closes.
- **Main page:** the current list's name as the title, with a selector when there is more than one list (only calendars that support `VTODO` are shown). Open tasks are sorted by due date, then by priority.
- **Task rows:** a round checkbox colored by priority completes the task (with Undo). Rows show the description, a color-coded due date and labels, plus an edit button on hover.
- **Add task:** the "+ Add task" row under the list (or the **Q** key) opens the same modal empty; its footer button says "Add task". New tasks get a random UID and are written with `If-None-Match: *`, so they can never overwrite an existing one.
- **Task modal:** shows everything about the task and lets you edit the title, description, an optional start date, the due date, priority and labels. An "All day" switch covers both dates: on means date only, off means date and time (iCalendar requires `DTSTART` and `DUE` to be the same type). Save and Cancel sit in the footer, and Ctrl/⌘+Enter saves.

`src/api/caldav.ts` is the CalDAV client (plain `fetch` + `DOMParser`), and `src/api/tasks.ts` converts between iCalendar `VTODO` and the task model using `ical.js`.

### Design decisions

- **All logic lives in the browser.** The backend is a dumb, stateless proxy; features are built in the frontend against standard CalDAV.
- **Preserve what other apps wrote.** Edits go through `applyEdits`, which only touches the fields the modal owns. Reminders (`VALARM`), repeat rules (`RRULE`) and any unknown properties set by other CalDAV clients are kept.
- **Optimistic concurrency with ETags.** Updates send `If-Match` with the task's ETag. If the task changed elsewhere in the meantime, the server refuses the save and the list reloads instead of overwriting.
- **Never clobber on create.** New tasks use `If-None-Match: *`.
- **Same origin in dev and prod.** Vite's dev server proxies `/proxy` to the backend, mirroring the production reverse proxy, so the frontend always calls relative `/proxy/...` URLs.

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

Each Bun script has a Node equivalent: `npm run dev:backend:node` and `npm run start:node`. `npm run start` runs the backend on Bun without watching. `npm run build:frontend` builds the app into `dist/frontend-react/`.

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
- **The path in `CALDAV_URL` is not a boundary.** A client could use `..` to reach other paths on the same CalDAV host, always with these same credentials. The CalDAV server's own permissions still apply.
- **Keep the password out of `localStorage`.** The frontend has to keep it in the browser in order to send it, so prefer memory or `sessionStorage`. Any XSS would expose it.
