import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '../theme.ts';

interface Props {
  /** The control it opens from: it is placed under it (above when there is more room there). */
  anchor: RefObject<View | null>;
  onClose: () => void;
  children: ReactNode;
  /** At least as wide as the anchor, as a select's list is. */
  matchWidth?: boolean;
  /** A cap on the height (its content scrolls past it), even with room to spare. */
  maxHeight?: number;
  /** Which edge of the anchor it lines up with: `end` suits a control at the right edge, like a menu button. */
  align?: 'start' | 'end';
  /** Width of the panel; by default its content's. */
  width?: number;
}

const GAP = 4;
const MARGIN = 8;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A floating panel for dropdowns and pickers, in a transparent Modal so nothing on screen can clip it. A tap
 * outside closes it, and only closes it (it doesn't reach what is behind), like a native select.
 */
export function Popover({ anchor, onClose, children, matchWidth = false, maxHeight = Infinity, align = 'start', width }: Props) {
  const colors = useColors();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [box, setBox] = useState<Box | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    anchor.current?.measureInWindow((x, y, w, h) => setBox({ x, y, width: w, height: h }));
  }, [anchor, window.width, window.height]);

  // Hidden until both the control and the panel are measured, so it never shows in the wrong place first.
  let position: ViewStyle = { opacity: 0, left: 0, top: 0 };
  if (box && size) {
    const top = insets.top + MARGIN;
    const bottom = window.height - insets.bottom - MARGIN;
    const below = bottom - (box.y + box.height + GAP);
    const above = box.y - GAP - top;
    const up = Math.min(maxHeight, size.height) > below && above > below;
    const left = align === 'end' ? box.x + box.width - size.width : box.x;
    position = {
      left: Math.max(MARGIN, Math.min(left, window.width - size.width - MARGIN)),
      ...(up ? { bottom: window.height - box.y + GAP } : { top: box.y + box.height + GAP }),
      maxHeight: Math.min(maxHeight, up ? above : below),
    };
  }

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} aria-label="Close" />
      <View
        style={[
          styles.panel,
          { backgroundColor: colors.bg, borderColor: colors.border, shadowColor: '#000' },
          { width, minWidth: matchWidth ? box?.width : undefined, maxWidth: window.width - 2 * MARGIN },
          position,
        ]}
        onLayout={(event) => {
          const { width: w, height: h } = event.nativeEvent.layout;
          if (w !== size?.width || h !== size?.height) setSize({ width: w, height: h });
        }}
      >
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: 'hidden',
    elevation: 8,
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
});
