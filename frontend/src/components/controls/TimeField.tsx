import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatTime } from '../../lib/format.ts';
import { useColors } from '../../theme.ts';
import { ClockIcon } from './icons.tsx';
import { Popover } from './Popover.tsx';

interface Props {
  /** HH:MM, or undefined for none yet. */
  value: string | undefined;
  onChange: (time: string) => void;
  'aria-label': string;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Every half hour, like Todoist's time list; any other time can be typed. */
const SLOTS = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`);
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const nearestSlot = (time: string) => Math.min(SLOTS.length - 1, Math.round(minutesOf(time) / 30));
const SLOT_HEIGHT = 36;

/**
 * Reads a typed time: "9", "930", "9:30", "9.30", "21h", "9pm", "9:30 a. m."... into HH:MM. Undefined when it
 * isn't one.
 */
export function parseTime(text: string): string | undefined {
  const cleaned = text
    .toLowerCase()
    .replace(/\s+/g, '') // also the narrow no-break space some locales put before AM/PM
    .replace(/([ap])\.?m\.?$/, '$1m');
  const match = /^(\d{1,2})(?:[:.h]?(\d{2}))?h?(am|pm|a|p)?$/.exec(cleaned);
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const half = match[3]?.[0];
  if (half && (hours < 1 || hours > 12)) return undefined;
  if (half === 'p' && hours < 12) hours += 12;
  if (half === 'a' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return undefined;
  return `${pad(hours)}:${pad(minutes)}`;
}

/**
 * A time button opening a box to type any time in, over the list of half hours. (The box is in the panel rather
 * than in the field itself: on a phone the panel would take the keyboard away from a field under it.)
 */
export function TimeField({ value, onChange, 'aria-label': label }: Props) {
  const colors = useColors();
  const trigger = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const typed = draft.trim() ? parseTime(draft) : undefined;

  function pick(time: string | undefined) {
    setOpen(false);
    setDraft('');
    if (time && time !== value) onChange(time);
  }

  const initial = nearestSlot(value ?? '09:00');
  return (
    <>
      <Pressable
        ref={trigger}
        role="button"
        aria-label={value ? `${label}: ${formatTime(value)}` : `${label}: none`}
        aria-expanded={open}
        onPress={() => setOpen(true)}
        style={({ pressed, hovered }) => [
          styles.trigger,
          { borderColor: colors.border, backgroundColor: pressed || hovered || open ? colors.bgHover : colors.bg },
        ]}
      >
        <ClockIcon color={colors.textTertiary} />
        <Text style={[styles.text, { color: value ? colors.text : colors.textTertiary }]}>
          {value ? formatTime(value) : 'Time'}
        </Text>
      </Pressable>
      {open && (
        <Popover anchor={trigger} onClose={() => pick(undefined)} width={180} maxHeight={300}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a time"
            placeholderTextColor={colors.textTertiary}
            aria-label={label}
            autoFocus
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => pick(typed)}
            style={[styles.input, { color: colors.text, borderBottomColor: colors.divider }]}
          />
          {draft.trim() !== '' && (
            <Pressable
              role="button"
              disabled={!typed}
              onPress={() => pick(typed)}
              style={({ pressed, hovered }) => [styles.slot, (pressed || hovered) && { backgroundColor: colors.bgHover }]}
            >
              <Text style={{ color: typed ? colors.accent : colors.textTertiary, fontSize: 14 }}>
                {typed ? `Set ${formatTime(typed)}` : 'Not a time'}
              </Text>
            </Pressable>
          )}
          <FlatList
            data={SLOTS}
            keyExtractor={(slot) => slot}
            initialScrollIndex={Math.max(0, initial - 2)}
            getItemLayout={(_, index) => ({ length: SLOT_HEIGHT, offset: SLOT_HEIGHT * index, index })}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            renderItem={({ item: slot }) => (
              <Pressable
                role="radio"
                aria-checked={slot === value}
                onPress={() => pick(slot)}
                style={({ pressed, hovered }) => [
                  styles.slot,
                  (pressed || hovered) && { backgroundColor: colors.bgHover },
                  slot === value && { backgroundColor: colors.bgSoft },
                ]}
              >
                <Text style={{ color: slot === value ? colors.accent : colors.text, fontSize: 14 }}>{formatTime(slot)}</Text>
              </Pressable>
            )}
          />
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
  },
  text: { fontSize: 13 },
  input: { fontSize: 14, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, outlineWidth: 0 },
  // Shrinks to the panel's height so the list scrolls inside it.
  list: { flexShrink: 1 },
  slot: { height: SLOT_HEIGHT, justifyContent: 'center', paddingHorizontal: 12 },
});
