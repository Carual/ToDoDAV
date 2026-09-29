import express, { type Router } from 'express';
import type { Config } from '../config.ts';
import { storedCalendar } from './stored.ts';
import { tasksAsEvents, type TaskOptions } from './tasks.ts';

/**
 * /feed/<path>: one calendar for subscribers that cannot log in (the token is already checked and removed).
 * Without options it is the calendar as stored. With tasks=1 its tasks become events, and the rest of the
 * query shapes them (see parseOptions); a changed URL is a new calendar to the subscriber.
 */
export function feed(config: Config): Router {
  const router = express.Router();
  const stored = storedCalendar(config);
  const converted = tasksAsEvents(config);

  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }
    const query = new URLSearchParams(req.originalUrl.split('?')[1] ?? '');
    let options: TaskOptions | undefined;
    try {
      options = parseOptions(query);
    } catch (error) {
      res.status(400).json({ error: 'bad_query', detail: (error as Error).message });
      return;
    }
    if (options) converted(req, res, options).catch(next);
    else stored(req, res, next);
  });

  return router;
}

const DEFAULT_OPTIONS: TaskOptions = { completed: true, subtasks: true, priorities: [1, 2, 3, 4], html: false, appLinksAsText: false, duration: 0 };

/**
 * `undefined` without tasks=1: the other options only shape tasks, so they mean nothing on the stored calendar.
 * Unknown parameters are ignored (a subscriber may add its own); a known one with a bad value is refused, so a
 * mistyped URL fails where it is pasted instead of quietly showing something else.
 */
export function parseOptions(query: URLSearchParams): TaskOptions | undefined {
  if (!flag(query, 'tasks', false)) return undefined;
  const options = { ...DEFAULT_OPTIONS };
  options.completed = flag(query, 'completed', options.completed);
  options.subtasks = flag(query, 'subtasks', options.subtasks);

  const priority = query.get('priority');
  if (priority !== null) {
    const priorities = priority.split(',').map((p) => Number(p.trim()));
    if (priorities.some((p) => ![1, 2, 3, 4].includes(p))) throw new Error('priority must list 1 to 4, e.g. priority=1,2');
    options.priorities = priorities;
  }

  const format = query.get('format');
  if (format !== null) {
    if (format !== 'text' && format !== 'html') throw new Error('format must be text or html');
    options.html = format === 'html';
  }

  // Only shapes the HTML: the text form already writes every link's address.
  const appLinks = query.get('applinks');
  if (appLinks !== null) {
    if (appLinks !== 'link' && appLinks !== 'text') throw new Error('applinks must be link or text');
    options.appLinksAsText = appLinks === 'text';
  }

  const duration = query.get('duration');
  if (duration !== null) {
    const minutes = Number(duration);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new Error('duration must be 0 to 1440 minutes');
    options.duration = minutes;
  }
  return options;
}

function flag(query: URLSearchParams, name: string, fallback: boolean): boolean {
  const value = query.get(name);
  if (value === null) return fallback;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  throw new Error(`${name} must be 1 or 0`);
}
