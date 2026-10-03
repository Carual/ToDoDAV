# AGENTS.md (frontend/)

The Expo app: ToDoDAV's main frontend for web, Android and iOS. The architecture, design decisions and conventions are in the [root AGENTS.md](../AGENTS.md); this file only adds what is specific to Expo and React Native.

## Expo changes with every SDK

APIs get renamed, moved or removed between SDK releases, so don't write Expo, EAS or React Native code from memory:

1. Read the major version of `expo` in `package.json`.
2. Use the matching docs: `https://docs.expo.dev/versions/v<major>.0.0/`.
3. For anything else, https://docs.expo.dev/llms.txt indexes all of Expo's docs.

## Commands

Run them in `frontend/` (or the root scripts `npm run dev:app`, `npm run dev:web`, `npm run typecheck:app`).

```sh
npx expo install <package>  # always, instead of npm install: picks the version that fits the SDK
npx expo start              # dev server (QR code for Expo Go, `a` Android, `w` web, `j` debugger)
npx tsc --noEmit            # typecheck (npm run typecheck)
npx expo-doctor             # dependency and config problems
npx expo install --fix      # bring packages back to the SDK's versions
```

npm manages the dependencies here too, with this folder's own `package.json` and lockfile (not a workspace: Expo pins its own React and React Native versions).

## Rules

- Routes live in `src/app/` (Expo Router): every file there is a screen and `_layout.tsx` files are navigators. Everything else goes outside it: hooks and contexts in `src/state/`, plain helpers in `src/lib/`, CalDAV/iCalendar/Todoist code in `src/api/`, and components in `src/components/` (`tasks/`, `journal/`, or `controls/` for generic UI).
- `ios/` and `android/` are generated (Continuous Native Generation) and ignored by git. Never create or edit them; configure native behavior in `app.json` and config plugins.
- Expo Go only has its own bundled native modules. A library with other native code needs a development build (`npx expo run:android`, or `eas build --profile development`), so prefer Expo's modules.
- Platform-specific files use `.native.ts` / `.web.ts` (or the plain `.ts` for the web): import them without the extension, so Metro picks the right one. Everything else is imported with its `.ts`/`.tsx` extension, like the rest of the repo.
- No DOM and no CSS: React Native primitives and `StyleSheet`, colors from `src/theme.ts`. Code that needs the browser (`window`, `document`) checks `Platform.OS === 'web'` first.
