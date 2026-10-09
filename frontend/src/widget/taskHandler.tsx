import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import {
  completeLocally,
  completeTask,
  forgetWidget,
  loadSnapshot,
  looksSame,
  readCache,
  readTicking,
  saveCompletion,
  saveTicking,
  TICK_MS,
  withTicks,
  type WidgetSnapshot,
} from './data.ts';
import { COMPLETE, REFRESH, widgetFor } from './TaskListWidget.tsx';

/**
 * What the launcher asks of the widget, run as a background task: drawing it (added, resized, every 30 minutes),
 * and the taps that aren't links. Each redraw makes the list flash and scroll back up, so the widget is only drawn
 * again when what it shows changed: the last rows first, then fresh ones if they differ.
 */
export async function widgetTaskHandler({ widgetInfo, widgetAction, clickAction, clickActionData, renderWidget }: WidgetTaskHandlerProps) {
  const id = widgetInfo.widgetId;
  let shown: WidgetSnapshot | null = null;
  // Rows ticked by this or another run, still undoable, are drawn ticked whatever else changes.
  const draw = (snapshot: WidgetSnapshot) => {
    const drawn = withTicks(snapshot, readTicking(id));
    if (looksSame(shown, drawn)) return;
    renderWidget(widgetFor(drawn));
    shown = drawn;
  };
  const cached = readCache(id);

  switch (widgetAction) {
    case 'WIDGET_DELETED':
      forgetWidget(id);
      return;

    case 'WIDGET_CLICK':
      if (clickAction === COMPLETE) {
        const { href, calendarHref } = (clickActionData ?? {}) as { href?: string; calendarHref?: string };
        if (!href || !calendarHref) return;
        const ticking = readTicking(id);

        // A second tap while the tick is still showing: undone, and nothing was sent.
        if (href in ticking) {
          shown = cached && withTicks(cached, ticking);
          delete ticking[href];
          saveTicking(id, ticking);
          if (cached) draw(cached);
          return;
        }

        // The widget doesn't hold the task (an old cache): done on the server's copy.
        if (!cached?.stored?.[href]) {
          await completeTask(calendarHref, href).catch(() => {});
          draw(await loadSnapshot(id, { quick: true }));
          return;
        }

        // Ticked at once; it only counts once the wait is over and no second tap took it back.
        const at = Date.now();
        saveTicking(id, { ...ticking, [href]: at });
        // The launcher still shows the cached rows (with any other pending ticks): only the change is drawn.
        shown = withTicks(cached, ticking);
        draw(cached);
        await new Promise((resolve) => setTimeout(resolve, TICK_MS));

        const now = readTicking(id);
        if (now[href] !== at) return;
        delete now[href];
        saveTicking(id, now);
        // Off the list (or on to its next date) from what the widget holds; the server is told after.
        const local = completeLocally(id, href);
        if (!local) return;
        draw(local.snapshot);
        try {
          await saveCompletion(calendarHref, href, local.saves, local.recurring);
        } catch {
          // Refused or unreachable: reading the list again shows where things stand.
        }
        // The lists are known: only the tasks are read again. Drawn only if the server differs from the guess.
        draw(await loadSnapshot(id, { quick: true }));
        return;
      }
      if (clickAction !== REFRESH) return;
      if (cached) draw({ ...cached, loading: true });
      break;

    default:
      if (cached) draw(cached);
  }

  draw(await loadSnapshot(id));
}
