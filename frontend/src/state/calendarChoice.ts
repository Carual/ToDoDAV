import { useEffect, useState } from 'react';

import type { Calendar } from '../api/caldav.ts';
import { readSetting, saveSetting } from '../lib/viewSettings.ts';

/** The "All" view's value where a calendar href would go; hrefs start with / or a scheme, so it can't clash. */
export const ALL = 'all';

/**
 * Which calendar is on screen, or ALL, remembered under `key`. "All" only makes sense with several calendars, and is
 * where the app starts then, like Todoist's all-projects views.
 */
export function useCalendarChoice(key: string, calendars: Calendar[]) {
  const canShowAll = calendars.length > 1;
  const [selected, setSelected] = useState(() => {
    const saved = readSetting(key);
    if (saved === ALL && canShowAll) return ALL;
    return calendars.find((c) => c.href === saved)?.href ?? (canShowAll ? ALL : calendars[0]?.href);
  });
  const allView = selected === ALL;
  /** The single calendar on screen; undefined in the "All" view. */
  const calendar = calendars.find((c) => c.href === selected);

  return {
    calendars,
    selected,
    allView,
    calendar,
    canShowAll,
    shownHrefs: allView ? calendars.map((c) => c.href) : calendar ? [calendar.href] : [],
    /** Shows one calendar, or every one with ALL. */
    selectCalendar(href: string) {
      setSelected(href);
      saveSetting(key, href);
    },
  };
}

export type CalendarChoice = ReturnType<typeof useCalendarChoice>;

/**
 * A link to a task or entry holds only its UID, so it can point to another calendar: once the one on screen is
 * loaded without it, look in the others and switch there, or call `onNotFound`.
 */
export function useFindElsewhere(
  uid: string,
  missing: boolean,
  choice: CalendarChoice,
  locate: (uid: string, calendars: Calendar[]) => Promise<string | undefined>,
  onNotFound: () => void,
) {
  useEffect(() => {
    if (!missing || !uid) return;
    let cancelled = false;
    const others = choice.allView ? [] : choice.calendars.filter((c) => c.href !== choice.selected);
    void locate(uid, others).then((found) => {
      if (cancelled) return;
      if (found) choice.selectCalendar(found);
      else onNotFound();
    });
    return () => {
      cancelled = true;
    };
  }, [missing, uid]);
}
