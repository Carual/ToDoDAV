# ToDoDAV

**A Todoist-style task manager for your own CalDAV server.**

You already host your calendars and tasks on a CalDAV server (Radicale, Nextcloud, Baïkal...), but the web UIs for tasks are either missing or clunky. ToDoDAV gives you a clean, fast, Todoist-like interface on top of the tasks you already have, without moving them anywhere.

- **Your data stays where it is.** Tasks are plain iCalendar `VTODO`s on your CalDAV server. ToDoDAV has no database and stores nothing.
- **Plays nicely with your other apps.** Keep using Thunderbird, Tasks.org (via DAVx⁵), or any other CalDAV client side by side. When you edit a task, ToDoDAV only changes the fields you touched, so reminders, repeat rules and anything else set by other apps are kept.
- **No lost edits.** If a task was changed on another device while you were editing it, ToDoDAV refuses to overwrite it and reloads the list instead.
- **Tiny to run.** One small Node/Bun process. Built and tested against Radicale.

> **Status:** early (v0.1). Usable day to day for viewing, adding, editing and completing tasks. Deleting tasks and moving them between lists are not there yet.

## Features

- Log in with your CalDAV username and password.
- Switch between your task lists (only calendars that support tasks are shown).
- Open tasks sorted by due date, then priority, with color-coded due dates and labels.
- Complete a task with one click, with Undo.
- See completed tasks in a collapsible section under the list, and reopen them.
- Add tasks with the "+ Add task" row or the **Q** key.
- Edit title, description, start date, due date (all-day or with a time), priority and labels. Ctrl/⌘+Enter saves.
- Optional read-only calendar feeds for Google Calendar, with a share button that gives you the link to copy (see [Calendar feeds](#calendar-feeds-google-calendar)).

## How it works

Browsers can't talk to most CalDAV servers directly, so ToDoDAV ships a very small backend that sits between them:

```
browser (the app)  ──►  ToDoDAV backend (/proxy)  ──►  your CalDAV server
```

The app in your browser does all the work and speaks CalDAV itself. The backend only checks your credentials and forwards requests to the one CalDAV server you configured. One ToDoDAV instance serves one CalDAV account.

## Requirements

- A CalDAV server with task (`VTODO`) support.
- [Bun](https://bun.sh) ≥ 1.4 or Node.js ≥ 22.18.
- A reverse proxy with HTTPS (Caddy, Traefik, nginx...) for anything reachable from outside your machine.

## Try it locally

```sh
git clone <this repo> tododav && cd tododav
npm install
cp .env.example .env    # set CALDAV_URL, CALDAV_USERNAME, CALDAV_PASSWORD
npm run dev
```

Open http://localhost:5173 and log in with the same username and password you put in `.env`.

## Deploying

1. **Build the web app** into `dist/frontend-react/` (this also typechecks everything):

   ```sh
   npm install
   npm run build
   ```

2. **Configure** `.env` (see [.env.example](.env.example)):

   | Variable | What it does |
   | --- | --- |
   | `NODE_ENV` | Set to `production`. Required when deploying: it enforces HTTPS. |
   | `CALDAV_URL` | Your CalDAV server, e.g. `https://dav.example.com/`. Must be `https://` in production. |
   | `CALDAV_USERNAME` | Your CalDAV username. |
   | `CALDAV_PASSWORD` | Your CalDAV password (ideally an app-specific one). |
   | `HOST` | Default `0.0.0.0`. Use `127.0.0.1` if the reverse proxy runs on the same machine. |
   | `PORT` | Default `3852`. |
   | `FEED_TASKS_ENABLED`, `FEED_EVENTS_ENABLED`, `FEED_TOKEN` | Optional calendar feeds, see [below](#calendar-feeds-google-calendar). |

3. **Start it**: `npm start` (Bun) or `npm run start:node` (Node). One process serves the app and the backend. Keep it running with systemd, Docker, pm2 or whatever you prefer. `GET /api/status` answers `{"status":"ok"}` so you can health-check it.

4. **Put it behind your reverse proxy** for HTTPS, forwarding everything to ToDoDAV. For example, with Caddy:

   ```caddy
   tasks.example.com {
       reverse_proxy 127.0.0.1:3852
   }
   ```

   With nginx/openresty, make sure the proxy *overwrites* the scheme header: `proxy_set_header X-Forwarded-Proto $scheme;`. Without that header, requests are rejected with `403`.

   If you'd rather have the reverse proxy serve the static files itself, point it at `dist/frontend-react/`, forward `/proxy/*`, `/api/*` and `/feed/*` to ToDoDAV, and answer any other non-file path with `index.html` (Caddy `try_files {path} /index.html`, nginx `try_files $uri /index.html`).

### With Docker

The [Dockerfile](Dockerfile) builds the app and runs it on Bun, with `NODE_ENV=production` already set and a health check on `/api/status`. Nothing needs to be installed on the host besides Docker. With [docker-compose.yaml](docker-compose.yaml):

```sh
docker compose up -d --build
```

- In `.env`, set `NODE_ENV=production` (or remove the line) and leave `HOST` unset: inside the container ToDoDAV must listen on `0.0.0.0`.
- The container is named `tododav`, and port `3852` is published on every address so a fresh install can be checked from anywhere. Once the reverse proxy above is on the same machine, change it to `127.0.0.1:3852:3852` so only programs on the host can reach it. [docker-compose.yaml](docker-compose.yaml)
- To update: `git pull`, then `docker compose up -d --build` again.

Without Compose:

```sh
docker build -t tododav .
docker run -d --name tododav --restart unless-stopped --init --env-file .env -p 127.0.0.1:3852:3852 tododav
```

Docker's `--env-file` takes values literally, so don't wrap them in quotes. To update, `docker rm -f tododav` and build and run again.

## Calendar feeds (Google Calendar)

Google Calendar can't log in to CalDAV and ignores tasks, so ToDoDAV can publish read-only `.ics` feeds for it. Both are off by default:

| Feed | Enable with | URL | What you get |
| --- | --- | --- | --- |
| Tasks | `FEED_TASKS_ENABLED=true` | `https://tasks.example.com/feed/tasks/<token>/juan/tasks/` | One task list, with each task shown as an event on its due date |
| Events | `FEED_EVENTS_ENABLED=true` | `https://tasks.example.com/feed/events/<token>/juan/calendar/` | One calendar, unchanged (needs Radicale) |

Enabling a feed requires `FEED_TOKEN`: a long random string (`openssl rand -hex 32`) that goes in the URL as `<token>`. **Anyone with the URL can read that calendar**, so keep it secret, and change the token to revoke old URLs. You don't have to build the URLs yourself: when a feed is on, the share button next to the list name shows the links for that list, ready to copy. In Google Calendar, add a link under *Other calendars → From URL*. Use one URL per list.

What to expect:

- **Read-only and slow to update.** Google refreshes subscribed calendars on its own schedule, often every 8–24 hours. Completing a task in Google isn't possible.
- **Tasks feed:** tasks without a due date and cancelled tasks are left out. Completed tasks stay with a ✓. A task with a start date before its due date spans both. Timed tasks are a point in time, and repeating tasks repeat. Priority and labels aren't shown.

## Security

- **Always deploy with `NODE_ENV=production`.** Without it, ToDoDAV accepts plain HTTP, and your password travels with every request.
- **Use a dedicated or app-specific password** if your CalDAV server supports them.
- Wrong passwords get a 1-second delay before the `401`, and the CalDAV server is never contacted for them.
- Your password is kept in the browser's `sessionStorage` while you're logged in, and is gone when you close the tab.
- The backend only ever talks to the host in `CALDAV_URL`. The path in it is not a hard boundary, though: your CalDAV server's own permissions are what protect other paths on that host.

## Contributing

Architecture, design decisions and development notes live in [AGENTS.md](AGENTS.md).
