# ToDoDAV

Self-hosted, Todoist-style task manager on top of any CalDAV server (built against Radicale).

```
browser (frontend: all the logic)  ──►  backend: /proxy/*  ──►  your CalDAV server
                                        credential check         (CALDAV_URL in env)
```

- **`frontend-react/`**: the Todoist-style web app (React + Vite). It speaks CalDAV itself (PROPFIND, REPORT, PUT...) against `/proxy/...`.
- **`backend/`**: a minimal Express proxy. It exists only because browsers cannot talk to most CalDAV servers directly. It stores nothing.

The tooling (`package.json`, `tsconfig.json`, `.env`) lives at the repository root. npm manages dependencies. Bun is the primary runtime, and Node works too. Both run the TypeScript directly, with no build step.

## Backend

Everything under `/proxy` is forwarded to `CALDAV_URL`. For example, `PROPFIND /proxy/juan/tasks/` becomes `PROPFIND <CALDAV_URL>juan/tasks/`. The request's method, headers and body are sent as-is, and the CalDAV server decides what is allowed.

`GET /` is a status check that answers `{"status":"ok"}`, even over plain HTTP, so a fresh install can be checked from anywhere. ToDoDAV listens on `0.0.0.0` by default.

For `/proxy`, the backend does only five things:

1. **HTTPS only in production.** When `NODE_ENV=production`, `/proxy` requests that did not arrive over HTTPS get `403`, and `CALDAV_URL` must be `https://`. ToDoDAV itself speaks plain HTTP behind a TLS reverse proxy (Caddy, Traefik, nginx/openresty), which must *overwrite* `X-Forwarded-Proto` (nginx/openresty: `proxy_set_header X-Forwarded-Proto $scheme;`). The header is only trusted from loopback and private-network addresses.
2. **Credential check.** The `Authorization: Basic ...` header must match `CALDAV_USERNAME` / `CALDAV_PASSWORD`. Otherwise it answers `401` after a 1-second delay, which slows down password guessing, and the CalDAV server is never contacted.
3. **Fixed host.** Requests always go to the host in `CALDAV_URL`. The client only chooses the path.
4. **MOVE destination.** The client sends the destination as an app URL (`https://app/proxy/juan/work/a.ics`), and the backend rewrites it to the CalDAV server's path (`/juan/work/a.ics`). The path has no host because, behind a reverse proxy, CalDAV servers often cannot recognize their own public host and reject the MOVE.
5. **No login popup.** The `WWW-Authenticate` header is removed from responses, so the browser never shows its native login prompt.

Security headers come from `helmet`, and the proxying itself from `http-proxy-middleware`.

### Configuration

See [.env.example](.env.example): `CALDAV_URL`, `CALDAV_USERNAME`, `CALDAV_PASSWORD`, and optionally `HOST` and `PORT`.

### Development

Requires Bun ≥ 1.4 (older Bun versions lowercase methods such as `PROPFIND`, which breaks CalDAV) or Node ≥ 22.18.

```sh
npm install
cp .env.example .env    # then edit it
npm run dev:backend     # runs on Bun: http://localhost:3000, restarts on changes
npm run typecheck
```

Each Bun script has a Node equivalent: `npm run dev:backend:node` and `npm run start:node`.

## Frontend (`frontend-react/`)

A React + Vite app that looks and behaves like Todoist:

- **Login:** asks the server for your task lists (a CalDAV PROPFIND), which only works with the right username and password. The credentials stay in `sessionStorage`, so they survive a reload but disappear when the tab closes.
- **Main page:** the current list's name as the title, with a selector when there is more than one list (only calendars that support tasks are shown). Open tasks are sorted by due date, then by priority.
- **Task rows:** a round checkbox colored by priority completes the task (with Undo). Rows show the description, a color-coded due date and labels, plus an edit button on hover.
- **Add task:** the "+ Add task" row under the list (or the **Q** key) opens the same modal empty; its footer button says "Add task". New tasks get a random UID and are written with `If-None-Match: *`, so they can never overwrite an existing one.
- **Task modal:** shows everything about the task and lets you edit the title, description, an optional start date, the due date, priority and labels. An "All day" switch covers both dates: on means date only, off means date and time (iCalendar requires DTSTART and DUE to be the same type). Save and Cancel sit in the footer, and Ctrl/⌘+Enter saves. Saving only changes those fields, so reminders, repeat rules and anything else set by other apps are kept. If the task changed elsewhere in the meantime, the save is refused and the list reloads.

`src/api/caldav.ts` is the CalDAV client (plain `fetch` + `DOMParser`), and `src/api/tasks.ts` converts between iCalendar `VTODO` and the task model using `ical.js`.

### Development

```sh
npm run dev             # starts both below with concurrently; if one crashes, the other stops too
```

Or separately, in two terminals:

```sh
npm run dev:backend     # the proxy on :3000 (reads .env)
npm run dev:frontend    # the app on http://localhost:5173, forwarding /proxy to the backend
```

Vite reads the same `PORT` as the backend (from `.env`), so changing it keeps both in sync.

`npm run build:frontend` builds the app into `dist/frontend-react/`.

## Security notes

- **Run with `NODE_ENV=production` when deploying.** If it's missing, ToDoDAV runs in development mode and accepts plain HTTP. Basic auth sends the password with every request, so development mode must never face the internet.
- **Use a dedicated or app-specific password** for ToDoDAV.
- **The path in `CALDAV_URL` is not a boundary.** A client could use `..` to reach other paths on the same CalDAV host, always with these same credentials. The CalDAV server's own permissions still apply.
- **Keep the password out of `localStorage`.** The frontend has to keep it in the browser in order to send it, so prefer memory or `sessionStorage`. Any XSS would expose it.
