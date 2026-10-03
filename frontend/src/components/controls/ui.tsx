import type { ReactNode, Ref } from 'react';
import { Pressable, Switch, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { useColors } from '../../theme.ts';

// Small building blocks shared by the screens: the app's buttons and switches.

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, onPress, variant = 'secondary', disabled = false, style }: ButtonProps) {
  const colors = useColors();
  const filled = variant !== 'secondary';
  const background = variant === 'danger' ? colors.p1 : colors.accent;
  return (
    <Pressable
      role="button"
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.button,
        filled
          ? { backgroundColor: pressed || hovered ? colors.accentHover : background, borderColor: 'transparent' }
          : { backgroundColor: pressed || hovered ? colors.bgHover : colors.bg, borderColor: colors.border },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: filled ? colors.accentText : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

interface IconButtonProps {
  label: string;
  onPress: () => void;
  children: ReactNode;
  /** Tinted in the accent color: a feature that is on (filters applied). */
  active?: boolean;
  /** Todoist's quick add: a red circle with a white icon. */
  filled?: boolean;
  disabled?: boolean;
  size?: number;
  ref?: Ref<View>;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({ label, onPress, children, active, filled, disabled, size = 28, ref, style }: IconButtonProps) {
  const colors = useColors();
  return (
    <Pressable
      ref={ref}
      role="button"
      aria-label={label}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.icon,
        { width: size, height: size, borderRadius: filled ? size / 2 : 4 },
        filled
          ? { backgroundColor: pressed || hovered ? colors.accentHover : colors.accent }
          : active
            ? { backgroundColor: `${colors.accent}1a` }
            : (pressed || hovered) && { backgroundColor: colors.bgHover },
        disabled && styles.disabled,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** A switch with its label, the whole row toggling it. */
export function SwitchRow({
  label,
  value,
  onChange,
  labelStyle,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  labelStyle?: StyleProp<TextStyle>;
}) {
  const colors = useColors();
  return (
    <Pressable role="switch" aria-checked={value} aria-label={label} onPress={() => onChange(!value)} style={styles.switchRow}>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor="#fff"
        // react-native-web's own prop for the thumb while on (teal by default).
        {...{ activeThumbColor: '#fff' }}
        // The row is the control for assistive technologies; the switch is its picture.
        importantForAccessibility="no-hide-descendants"
        aria-hidden
        style={styles.switch}
      />
      <Text style={[styles.switchLabel, { color: colors.textSecondary }, labelStyle]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  icon: { alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // The row takes every tap, so one tap on the switch itself doesn't toggle it twice.
  switch: { transform: [{ scale: 0.8 }], marginVertical: -6, pointerEvents: 'none' },
  switchLabel: { fontSize: 12 },
});
