import type { LocalDate } from './api/tasks.ts';

export type DueTone = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatTime(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Todoist-style due label ("Today", "Tomorrow", "Friday", "3 Oct") and its color tone. */
export function describeDue(due: LocalDate, now = new Date()): { label: string; tone: DueTone } {
  const day = new Date(`${due.date}T00:00`);
  const days = Math.round((day.getTime() - startOfDay(now).getTime()) / DAY_MS);
  const time = due.time ? ` ${formatTime(due.time)}` : '';

  let label: string;
  if (days === 0) label = 'Today';
  else if (days === 1) label = 'Tomorrow';
  else if (days === -1) label = 'Yesterday';
  else if (days > 1 && days < 7) label = day.toLocaleDateString(undefined, { weekday: 'long' });
  else {
    const sameYear = day.getFullYear() === now.getFullYear();
    label = day.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
  }

  const passedToday = days === 0 && due.time !== undefined && new Date(`${due.date}T${due.time}`) < now;
  const tone: DueTone =
    days < 0 || passedToday ? 'overdue' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? 'week' : 'later';
  return { label: label + time, tone };
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
