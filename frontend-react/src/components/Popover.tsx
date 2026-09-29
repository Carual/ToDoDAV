import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** The control it opens from: it is placed under it (above when there is more room there). */
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** At least as wide as the anchor, as a select's list is. */
  matchWidth?: boolean;
  /** A cap on the height (it scrolls past it), even with room to spare. */
  maxHeight?: number;
  /** Which edge of the anchor it lines up with: `end` suits a control at the right edge, like a menu button. */
  align?: 'start' | 'end';
}

const GAP = 4;
const MARGIN = 8;

/**
 * A floating panel for dropdowns and pickers. It lives in <body>, so the modals' scrolling areas can't clip it
 * and a <label> around the control doesn't forward clicks made inside it.
 */
export function Popover({
  anchor,
  onClose,
  children,
  className = '',
  matchWidth = false,
  maxHeight = Infinity,
  align = 'start',
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    function place() {
      const box = anchor.current?.getBoundingClientRect();
      const panel = ref.current;
      if (!box || !panel) return;
      const viewportWidth = document.documentElement.clientWidth;
      const below = window.innerHeight - box.bottom - GAP - MARGIN;
      const above = box.top - GAP - MARGIN;
      const up = Math.min(panel.scrollHeight, maxHeight) > below && above > below;
      const width = Math.max(panel.offsetWidth, matchWidth ? box.width : 0);
      const left = align === 'end' ? box.right - width : box.left;
      setStyle({
        left: Math.max(MARGIN, Math.min(left, viewportWidth - width - MARGIN)),
        minWidth: matchWidth ? box.width : undefined,
        maxHeight: Math.min(maxHeight, up ? above : below),
        ...(up ? { bottom: window.innerHeight - box.top + GAP } : { top: box.bottom + GAP }),
      });
    }
    place();
    // Follows the control when something scrolls, and the panel when its content changes size (another month).
    const resize = new ResizeObserver(place);
    resize.observe(ref.current!);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, matchWidth, maxHeight, align]);

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor.current?.contains(target)) return;
      closeRef.current();
      // Like a native select: a click outside only closes the list, rather than also closing the modal behind it.
      event.stopPropagation();
    }
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [anchor]);

  return createPortal(
    <div ref={ref} className={`popover ${className}`} style={style}>
      {children}
    </div>,
    document.body,
  );
}
