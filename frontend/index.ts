// The polyfills must run before any app code.
import './src/polyfills.ts';
// Before the navigator, so its listener for the browser's Back runs first.
import './src/leaveGuard.ts';

import { registerRootComponent } from 'expo';

import { App } from './src/App.tsx';

registerRootComponent(App);
