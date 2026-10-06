import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { completeTask, forgetWidget, loadSnapshot, readCache, withRowDone } from './data.ts';
import { COMPLETE, REFRESH, widgetFor } from './TaskListWidget.tsx';

/**
 * What the launcher asks of the widget, run as a background task: drawing it (added, resized, every 30 minutes),
 * and the taps that aren't links. The last rows shown are drawn first, so the widget never sits empty while the
 * server answers.
 */
export async function widgetTaskHandler({ widgetInfo, widgetAction, clickAction, clickActionData, renderWidget }: WidgetTaskHandlerProps) {
  const id = widgetInfo.widgetId;
  const cached = readCache(id);

  switch (widgetAction) {
    case 'WIDGET_DELETED':
      forgetWidget(id);
      return;

    case 'WIDGET_CLICK':
      if (clickAction === COMPLETE) {
        const { href, calendarHref, recurring } = (clickActionData ?? {}) as { href?: string; calendarHref?: string; recurring?: boolean };
        if (!href || !calendarHref) return;
        // Ticked at once, like the app's checkbox; the row leaves when the list is read again.
        if (cached) renderWidget(widgetFor(withRowDone(cached, href)));
        try {
          await completeTask(calendarHref, href, Boolean(recurring));
        } catch {
          // Refused (changed elsewhere) or unreachable: reading the list again shows where things stand.
        }
      } else if (clickAction === REFRESH) {
        if (cached) renderWidget(widgetFor({ ...cached, loading: true }));
      } else {
        return;
      }
      break;

    default:
      if (cached) renderWidget(widgetFor(cached));
  }

  renderWidget(widgetFor(await loadSnapshot(id)));
}
