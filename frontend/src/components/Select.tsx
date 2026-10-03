import { useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from '../theme.ts';
import { CheckIcon, ChevronDownIcon } from './icons.tsx';
import { Popover } from './Popover.tsx';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface Props<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  'aria-label': string;
  disabled?: boolean;
  /** Borderless until pressed, like Todoist's project picker in the list header. */
  quiet?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A dropdown in the app's own style: a button showing the choice, opening a list of options under it. */
export function Select<T extends string>({ value, options, onChange, 'aria-label': label, disabled = false, quiet = false, style }: Props<T>) {
  const colors = useColors();
  const trigger = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  function choose(option: SelectOption<T>) {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  }

  return (
    <>
      <Pressable
        ref={trigger}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed, hovered }) => [
          styles.trigger,
          { borderColor: quiet && !open && !hovered ? 'transparent' : colors.border },
          (pressed || hovered || open) && { backgroundColor: colors.bgHover },
          disabled && { opacity: 0.5 },
          style,
        ]}
      >
        {selected?.icon}
        <Text style={[styles.value, { color: quiet ? colors.textSecondary : colors.text }]} numberOfLines={1}>
          {selected?.label ?? ''}
        </Text>
        <ChevronDownIcon color={colors.textTertiary} />
      </Pressable>
      {open && (
        <Popover anchor={trigger} onClose={() => setOpen(false)} matchWidth maxHeight={320}>
          <ScrollView role="radiogroup" aria-label={label} style={styles.list}>
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  role="radio"
                  aria-checked={isSelected}
                  onPress={() => choose(option)}
                  style={({ pressed, hovered }) => [styles.option, (pressed || hovered) && { backgroundColor: colors.bgHover }]}
                >
                  {option.icon}
                  <Text style={[styles.optionLabel, { color: colors.text }]} numberOfLines={1}>
                    {option.label}
                  </Text>
                  <View style={styles.check}>{isSelected && <CheckIcon color={colors.accent} />}</View>
                </Pressable>
              );
            })}
          </ScrollView>
        </Popover>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 6,
    flexShrink: 1,
  },
  value: { fontSize: 14, flexShrink: 1 },
  // Shrinks to the panel's height so long lists scroll inside it.
  list: { flexShrink: 1 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, minHeight: 40 },
  optionLabel: { flexShrink: 1, fontSize: 14 },
  check: { width: 12, marginLeft: 'auto', paddingLeft: 8, boxSizing: 'content-box' },
});
