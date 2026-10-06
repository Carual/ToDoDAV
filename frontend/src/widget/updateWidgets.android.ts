import { widgetsAvailable } from './available.ts';

/**
 * Redraws every widget on the home screen from the server: after logging in or out, and when the app goes to the
 * background, so what was just done in the app shows on the home screen.
 */
export function updateWidgets() {
  if (!widgetsAvailable) return;
  // Required here, not imported: in Expo Go loading the library would throw (see available.ts).
  const { requestWidgetUpdate } = require('react-native-android-widget') as typeof import('react-native-android-widget');
  const { loadSnapshot } = require('./data.ts') as typeof import('./data.ts');
  const { WIDGET_NAME, widgetFor } = require('./TaskListWidget.tsx') as typeof import('./TaskListWidget.tsx');
  requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: async (info) => widgetFor(await loadSnapshot(info.widgetId)) }).catch(() => {});
}
