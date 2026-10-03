import { useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useColors } from '../../theme.ts';
import { MoreIcon } from './icons.tsx';
import { Popover } from './Popover.tsx';
import { IconButton } from './ui.tsx';

export interface MenuItem {
  label: string;
  /** Draws the item's icon in the color it is given. */
  icon?: (color: string) => ReactNode;
  /** Shown in red: an action that removes something, such as deleting. */
  danger?: boolean;
  onSelect: () => void;
}

/** A three-dots button with a list of actions. */
export function Menu({ items, 'aria-label': label }: { items: MenuItem[]; 'aria-label': string }) {
  const colors = useColors();
  const trigger = useRef<View>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton ref={trigger} label={label} onPress={() => setOpen(true)}>
        <MoreIcon color={colors.textSecondary} />
      </IconButton>
      {open && (
        <Popover anchor={trigger} onClose={() => setOpen(false)} align="end">
          <View role="menu" aria-label={label} style={styles.menu}>
            {items.map((item) => {
              const color = item.danger ? colors.p1 : colors.text;
              return (
                <Pressable
                  key={item.label}
                  role="menuitem"
                  onPress={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  style={({ pressed, hovered }) => [styles.item, (pressed || hovered) && { backgroundColor: colors.bgHover }]}
                >
                  {item.icon?.(item.danger ? colors.p1 : colors.textSecondary)}
                  <Text style={[styles.label, { color }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Popover>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  menu: { paddingVertical: 4, minWidth: 200 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  label: { fontSize: 14 },
});
