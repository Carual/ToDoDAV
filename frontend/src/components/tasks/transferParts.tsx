import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColors, fs, type Colors } from '../../theme.ts';

// What the import and export dialog and the Todoist account import share.

export const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
export const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

/** A line of text: plain, the outcome of a step (`status`), or what went wrong (`error`). */
export function Message({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'status' | 'error' | 'muted' }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <Text
      role={tone === 'error' ? 'alert' : tone === 'status' ? 'status' : undefined}
      style={[styles.message, tone === 'error' && styles.error, tone === 'muted' && styles.muted]}
    >
      {children}
    </Text>
  );
}

/** Bold text inside a Message. */
export function Strong({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <Text style={{ fontWeight: '700', color: colors.text }}>{children}</Text>;
}

/** A link-styled button inside a line of text ("Try again", "Load the rest"). */
export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Text role="button" onPress={onPress} style={{ color: colors.link }}>
      {label}
    </Text>
  );
}

/** A row of buttons, wrapping on narrow screens. */
export function Actions({ children }: { children: ReactNode }) {
  return <View style={layout.actions}>{children}</View>;
}

/** A spinner with what is going on, and an optional button (Stop). */
export function Progress({ label, children }: { label: string; children?: ReactNode }) {
  const colors = useColors();
  return (
    <View role="status" style={layout.progress}>
      <ActivityIndicator color={colors.textTertiary} aria-label={label} />
      {children}
    </View>
  );
}

/** Progress text, beside the spinner. */
export function ProgressText({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <Text style={[makeStyles(colors).message, layout.shrink]}>{children}</Text>;
}

/** Things an import or export could not carry over as they were. */
export function Warnings({ warnings }: { warnings: string[] }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  if (warnings.length === 0) return null;
  return (
    <View style={styles.warnings}>
      {warnings.map((warning) => (
        <Text key={warning} style={styles.warning}>
          • {warning}
        </Text>
      ))}
    </View>
  );
}

/** Tasks (or lists) that could not be saved, under a heading saying so. */
export function Failures({ title, failures }: { title: string; failures: string[] }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  if (failures.length === 0) return null;
  return (
    <View style={styles.failures}>
      <Text style={[styles.message, styles.error]}>{title}</Text>
      {failures.map((failure, index) => (
        <Text key={index} style={styles.failure}>
          • {failure}
        </Text>
      ))}
    </View>
  );
}

/** A secondary button holding a spinner while its action runs (Export, Connect). */
export function BusyButton({
  label,
  busyLabel,
  busy,
  disabled,
  primary,
  onPress,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled?: boolean;
  primary?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const off = disabled || busy;
  return (
    <Pressable
      role="button"
      aria-busy={busy}
      aria-disabled={off}
      disabled={off}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        layout.button,
        primary
          ? { backgroundColor: pressed || hovered ? colors.accentHover : colors.accent, borderColor: 'transparent' }
          : { backgroundColor: pressed || hovered ? colors.bgHover : colors.bg, borderColor: colors.border },
        disabled && !busy && layout.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={primary ? colors.accentText : colors.textTertiary} aria-label={busyLabel} />
      ) : (
        <Text style={[layout.buttonText, { color: primary ? colors.accentText : colors.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const layout = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  progress: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  shrink: { flexShrink: 1 },
  // As ui.tsx's Button, with room for the spinner.
  button: {
    minHeight: 34,
    minWidth: 80,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: fs(13), fontWeight: '600' },
  disabled: { opacity: 0.5 },
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    message: { fontSize: fs(13), lineHeight: fs(20), color: colors.textSecondary },
    muted: { fontSize: fs(12), lineHeight: fs(18), color: colors.textTertiary },
    error: { color: colors.p1 },
    warnings: { gap: 4, padding: 10, borderRadius: 6, backgroundColor: colors.bgSoft },
    warning: { fontSize: fs(12), lineHeight: fs(18), color: colors.textSecondary },
    failures: { gap: 4 },
    failure: { fontSize: fs(12), lineHeight: fs(18), color: colors.textSecondary },
  });
