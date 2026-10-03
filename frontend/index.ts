// The polyfills must run before any app code, so they come ahead of Expo Router's own entry.
import './src/polyfills.ts';
// Before the router, so its listener for the browser's Back runs first.
import './src/leaveGuard.ts';
import 'expo-router/entry';
