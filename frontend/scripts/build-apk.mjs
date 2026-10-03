// Builds an installable Android APK on this machine (no EAS): regenerates android/ from app.json,
// runs Gradle's release build and copies the APK to the repository's dist/tododav.apk.
// The release build is signed with the debug keystore from Expo's template: fine for installing it
// directly (and updating it over itself), but the Play Store needs a keystore of your own.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const androidDir = path.join(appDir, 'android');
const output = path.resolve(appDir, '../dist/tododav.apk');
const windows = process.platform === 'win32';

// Neither is on PATH after a plain Android Studio install, so look where it puts them.
const androidHome = find(process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, [
  windows && path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk'),
  path.join(homedir(), 'Library', 'Android', 'sdk'),
  path.join(homedir(), 'Android', 'Sdk'),
]);
const javaHome = find(process.env.JAVA_HOME, undefined, [
  windows && path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Android', 'Android Studio', 'jbr'),
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  '/opt/android-studio/jbr',
]);
if (!androidHome || !javaHome) {
  if (!androidHome) console.error('Android SDK not found: install Android Studio, or set ANDROID_HOME.');
  if (!javaHome) console.error('JDK not found: install Android Studio (it bundles one), or set JAVA_HOME to a JDK 17.');
  process.exit(1);
}
const env = {
  ...process.env,
  ANDROID_HOME: androidHome,
  JAVA_HOME: javaHome,
  PATH: [path.join(javaHome, 'bin'), process.env.PATH].join(path.delimiter),
};

// android/ is generated (git-ignored), so it is rebuilt from app.json every time rather than edited.
// Prebuild also points the android/ios scripts in package.json at native builds; those stay on Expo Go.
const packageJson = path.join(appDir, 'package.json');
const scripts = readFileSync(packageJson);
const prebuilt = run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean'], appDir);
writeFileSync(packageJson, scripts);
if (prebuilt !== 0) process.exit(prebuilt);
// Full path: Windows may not look for commands in the current directory (NoDefaultCurrentDirectoryInExePath).
// Quoted because the shell that runs .bat files would split it at spaces.
const gradlew = path.join(androidDir, windows ? 'gradlew.bat' : 'gradlew');
const built = run(windows ? `"${gradlew}"` : gradlew, ['assembleRelease'], androidDir);
if (built !== 0) process.exit(built);

mkdirSync(path.dirname(output), { recursive: true });
copyFileSync(path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), output);
console.log(`\nAPK ready: ${output}`);

function find(fromEnv, fallbackEnv, candidates) {
  return [fromEnv, fallbackEnv, ...candidates].find((dir) => dir && existsSync(dir));
}

function run(command, args, cwd) {
  // .cmd/.bat files only start through a shell on Windows.
  return spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: windows }).status ?? 1;
}
