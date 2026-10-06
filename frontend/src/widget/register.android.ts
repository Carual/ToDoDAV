import { widgetsAvailable } from './available.ts';

/** The widget's background task and its list picker; called from index.ts, after the polyfills (it uses localStorage). */
export function registerWidget() {
  if (!widgetsAvailable) return;
  // Required here, not imported: in Expo Go loading the library would throw (see available.ts).
  const { registerWidgetConfigurationScreen, registerWidgetTaskHandler } =
    require('react-native-android-widget') as typeof import('react-native-android-widget');
  const { widgetTaskHandler } = require('./taskHandler.tsx') as typeof import('./taskHandler.tsx');
  const { WidgetConfiguration } = require('./WidgetConfiguration.tsx') as typeof import('./WidgetConfiguration.tsx');
  registerWidgetTaskHandler(widgetTaskHandler);
  registerWidgetConfigurationScreen(WidgetConfiguration);
}
