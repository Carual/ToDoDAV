// The polyfills must run before any app code.
import './src/polyfills.ts';
// Before the navigator, so its listener for the browser's Back runs first.
import './src/leaveGuard.ts';

import { registerRootComponent } from 'expo';

import { App } from './src/App.tsx';
// No extension: register.android.ts on Android (the home-screen widget), a no-op elsewhere.
import { registerWidget } from './src/widget/register';

registerRootComponent(App);
registerWidget();
