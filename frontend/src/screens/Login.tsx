import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Transport } from '../api/caldav.ts';
import { connect, logIn, normalizeServerUrl } from '../api/connect.ts';
import { LogoMark } from '../components/LogoMark.tsx';
import { readLastLogin, writeLastLogin } from '../state/loginStore.ts';
import { useSession } from '../state/session.tsx';
import { useColors, type Colors } from '../theme.ts';

// The web build is served by the ToDoDAV backend and goes through its /proxy; the apps ask for the server.
const ASKS_SERVER = Platform.OS !== 'web';

export function Login() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { signIn, restoreError } = useSession();
  const [last] = useState(readLastLogin);
  const [server, setServer] = useState(last.server);
  const [username, setUsername] = useState(last.username);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(restoreError);
  const [busy, setBusy] = useState(false);
  const usernameInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);

  async function submit() {
    if (busy) return;
    // Caught here rather than by the server, which would only answer with a generic refusal.
    const missing = [ASKS_SERVER && !server.trim() && 'server', !username.trim() && 'username', !password && 'password'].filter(
      (field): field is string => Boolean(field),
    );
    if (missing.length > 0) {
      setError(`Enter your ${new Intl.ListFormat('en', { type: 'conjunction' }).format(missing)}.`);
      if (missing[0] === 'username') usernameInput.current?.focus();
      if (missing[0] === 'password') passwordInput.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const credentials = { username: username.trim(), password };
    try {
      if (ASKS_SERVER) {
        // Plain http:// only while developing, for a CalDAV server on the local network.
        const url = normalizeServerUrl(server, __DEV__);
        const { session, transport } = await connect(url, credentials);
        writeLastLogin(url, credentials.username);
        signIn(session, { ...credentials, transport });
      } else {
        const transport: Transport = { kind: 'proxy', origin: '' };
        const session = await logIn(credentials, transport);
        writeLastLogin('', credentials.username);
        signIn(session, { ...credentials, transport });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.brand}>
              <LogoMark size={24} />
              <Text style={styles.brandText}>ToDoDAV</Text>
            </View>
            <Text style={styles.title} role="heading">
              Log in
            </Text>

            {ASKS_SERVER && (
              <Field
                label="Server"
                colors={colors}
                value={server}
                onChangeText={setServer}
                placeholder="https://caldav.example.com"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="url"
                keyboardType="url"
                textContentType="URL"
                returnKeyType="next"
                autoFocus={!last.server}
                onSubmitEditing={() => usernameInput.current?.focus()}
                submitBehavior="submit"
              />
            )}
            <Field
              ref={usernameInput}
              label="Username"
              colors={colors}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              returnKeyType="next"
              autoFocus={!ASKS_SERVER && !last.username}
              onSubmitEditing={() => passwordInput.current?.focus()}
              submitBehavior="submit"
            />
            <Field
              ref={passwordInput}
              label="Password"
              colors={colors}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              autoFocus={Boolean(last.username) && (!ASKS_SERVER || Boolean(last.server))}
              onSubmitEditing={submit}
            />

            {error && (
              <Text style={styles.error} role="alert">
                {error}
              </Text>
            )}

            <Pressable
              onPress={submit}
              disabled={busy}
              role="button"
              aria-busy={busy}
              style={({ pressed }) => [styles.button, (pressed || busy) && { backgroundColor: colors.accentHover }]}
            >
              {busy ? (
                <ActivityIndicator color={colors.accentText} aria-label="Logging in" />
              ) : (
                <Text style={styles.buttonText}>Log in</Text>
              )}
            </Pressable>

            <Text style={styles.hint}>
              {ASKS_SERVER
                ? 'The address of your CalDAV server (Radicale, Nextcloud…) or of a ToDoDAV server, and the username and password of your CalDAV account.'
                : 'Use the username and password of your CalDAV server.'}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, colors, ref, ...input }: TextInputProps & { label: string; colors: Colors; ref?: React.Ref<TextInput> }) {
  const [focused, setFocused] = useState(false);
  const styles = makeStyles(colors);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        {...input}
        aria-label={label}
        placeholderTextColor={colors.textTertiary}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, focused && { borderColor: colors.textTertiary }]}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 24 },
    card: { width: '100%', maxWidth: 400, alignSelf: 'center' },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    brandText: { fontSize: 18, fontWeight: '700', color: colors.text },
    title: { fontSize: 32, lineHeight: 38, fontWeight: '700', color: colors.text, marginTop: 40, marginBottom: 24 },
    field: { marginBottom: 16 },
    label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.text,
      backgroundColor: colors.bg,
      // The browser's focus ring doubles the border, which turns darker on focus instead.
      outlineWidth: 0,
    },
    error: { color: colors.p1, fontSize: 13, marginBottom: 16 },
    button: {
      backgroundColor: colors.accent,
      borderRadius: 8,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonText: { color: colors.accentText, fontSize: 15, fontWeight: '600' },
    hint: { marginTop: 16, fontSize: 13, lineHeight: 19, color: colors.textTertiary },
  });
