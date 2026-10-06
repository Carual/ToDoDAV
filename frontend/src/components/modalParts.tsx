import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Calendar } from '../api/caldav.ts';
import type { LocalDate } from '../api/ical.ts';
import { describeDue, formatDateTime } from '../lib/format.ts';
import { setLeaveGuard } from '../leaveGuard.ts';
import { todayDate } from '../lib/repeat.ts';
import { useColors, type Colors } from '../theme.ts';
import { ConfirmDialog } from './controls/ConfirmDialog.tsx';
import { DatePicker } from './controls/DatePicker.tsx';
import { CloseIcon, HashIcon, MapPinIcon, PencilIcon } from './controls/icons.tsx';
import { Menu, type MenuItem } from './controls/Menu.tsx';
import { Select } from './controls/Select.tsx';
import { TimeField } from './controls/TimeField.tsx';
import { Button, IconButton } from './controls/ui.tsx';

// What the task modal and the journal modal share.

/** Time given to a date when "All day" is switched off. */
export const DEFAULT_TIME = '09:00';
/** From this width the details go in a sidebar next to the text, as on a computer. */
const WIDE = 768;

/**
 * How leaving is guarded when something is unsaved. `navigation`: the modal is a screen (/tasks/<uid>), and every
 * way of leaving it (its buttons, Android's back button, the browser's Back) goes through the navigator, which
 * asks first. `self`: the modal is not a screen (something new), and its own ways out ask.
 */
export type Guard = 'navigation' | 'self';

/**
 * The "Save changes?" question for a modal with unsaved work. The question only says whether to go on leaving;
 * saving, when chosen, is done by the dialog before it answers.
 */
export function useLeavePrompt(guard: Guard, guarded: boolean, onClose: () => void) {
  const navigation = useNavigation();
  /** What the question is about: how to leave, and what staying means (a browser move waits for the answer). */
  const [pendingLeave, setPendingLeave] = useState<{ go: () => void; stay?: () => void } | null>(null);
  /** Set when the modal leaves on purpose (after saving, deleting...), so the navigator lets it go unasked. */
  const leavingOnPurpose = useRef(false);

  const askThen = (go: () => void, stay?: () => void) => setPendingLeave({ go, stay });

  // A modal that goes away while asking (its task reloaded under it) leaves a browser move waiting: it stays put.
  const pendingRef = useRef(pendingLeave);
  pendingRef.current = pendingLeave;
  useEffect(() => () => pendingRef.current?.stay?.(), []);

  usePreventRemove(guard === 'navigation' && guarded, ({ data }) => {
    const go = () => navigation.dispatch(data.action);
    if (leavingOnPurpose.current) go();
    else askThen(go);
  });

  // The browser's Back and Forward don't reach usePreventRemove, nor a modal that isn't a screen: while something
  // is unsaved, leaveGuard.ts holds the move back and this asks. On Save or Discard the move is replayed: as a
  // screen, the navigator then follows it (unasked, since the modal is leaving on purpose); otherwise the modal
  // closes first. A reload or closing the tab can only get the browser's own prompt.
  useEffect(() => {
    if (Platform.OS !== 'web' || !guarded) return;
    const removeGuard = setLeaveGuard(() => {
      if (leavingOnPurpose.current) return undefined; // the modal's own way out, already asked or nothing to ask
      return new Promise<boolean>((resolve) =>
        askThen(
          () => {
            if (guard === 'self') onClose();
            resolve(true);
          },
          () => resolve(false),
        ),
      );
    });
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      removeGuard();
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [guard, guarded, onClose]);

  /** Leaves after an action that leaves nothing to ask about (saved, deleted, completed). */
  function leaveNow(go: () => void = onClose) {
    leavingOnPurpose.current = true;
    go();
  }

  return {
    asking: pendingLeave !== null,
    /** The modal's own ways out (×, Cancel, the backdrop, Escape). As a screen, the navigator asks if needed. */
    requestClose() {
      if (guard === 'self' && guarded) askThen(onClose);
      else onClose();
    },
    /**
     * Shows something else (another task), asking first in both modes: the router may show it in this same screen,
     * which the navigator wouldn't see as leaving.
     */
    leaveTo(go: () => void) {
      if (guarded) askThen(go);
      else leaveNow(go);
    },
    leaveNow,
    /** The answer: leave (after Save or Discard) or stay. */
    answer(leave: boolean) {
      const pending = pendingLeave;
      setPendingLeave(null);
      if (!pending) return;
      if (leave) leaveNow(pending.go);
      else pending.stay?.();
    },
  };
}

interface ShellProps {
  guard: Guard;
  /** What the dialog is, for assistive technologies ("Task details", "Add note"...). */
  label: string;
  /** The calendar shown at the top left, and whatever follows it (a parent task). */
  calendar: Calendar;
  crumb?: ReactNode;
  menuItems: MenuItem[];
  onRequestClose: () => void;
  /** The text side: title, description, sub-tasks. */
  main: ReactNode;
  /** The details: next to the text on wide screens, under it on phones. */
  sidebar: ReactNode;
  /** Why the changes can't be saved, under the content. */
  message: string | null;
  saveLabel: string;
  canSave: boolean;
  onSave: () => void;
  /** Escape and Ctrl/⌘+Enter on the web, unless a dialog on top owns the keyboard. */
  keys: boolean;
  /** Escape for something inside the modal (a field it closes) first: true when it was taken. */
  onEscape?: () => boolean;
  /** Dialogs drawn over the modal. */
  children?: ReactNode;
}

/** The modal's frame: header, the text and its details, and the footer with Cancel and Save. */
export function ModalShell({
  guard,
  label,
  calendar,
  crumb,
  menuItems,
  onRequestClose,
  main,
  sidebar,
  message,
  saveLabel,
  canSave,
  onSave,
  keys,
  onEscape,
  children,
}: ShellProps) {
  const colors = useColors();
  const styles = useModalStyles();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const insets = useSafeAreaInsets();

  // Escape on keyup, as react-native-web's Modal does: on keydown, the "Save changes?" dialog it opens would be up in
  // time for the same key's keyup, which closes it again. A Modal on top (a picker, a dialog) takes that keyup and
  // stops it before it reaches window, so Escape closes only the innermost thing.
  useEffect(() => {
    if (Platform.OS !== 'web' || !keys) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canSave) onSave();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !onEscape?.()) onRequestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  const sidebarView = <View style={[styles.sidebar, wide ? styles.sidebarWide : styles.sidebarNarrow]}>{sidebar}</View>;

  const page = (
    <View style={[styles.backdrop, wide ? styles.backdropWide : null]}>
      {wide && <Pressable style={StyleSheet.absoluteFill} onPress={onRequestClose} aria-label="Close" />}
      <View
        role="dialog"
        aria-modal
        aria-label={label}
        style={[styles.modal, wide ? styles.modalWide : { flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }]}
      >
        <View style={styles.header}>
          <View style={styles.crumb}>
            <HashIcon color={calendar.color ?? colors.textTertiary} size={14} />
            <Text style={styles.crumbText} numberOfLines={1}>
              {calendar.name}
            </Text>
            {crumb}
          </View>
          <View style={styles.headerActions}>
            {menuItems.length > 0 && <Menu aria-label="More actions" items={menuItems} />}
            <IconButton label="Close" onPress={onRequestClose}>
              <CloseIcon color={colors.textSecondary} />
            </IconButton>
          </View>
        </View>

        {wide ? (
          <View style={styles.contentWide}>
            <ScrollView style={styles.grow} keyboardShouldPersistTaps="handled">
              {main}
            </ScrollView>
            <ScrollView style={styles.sidebarScroll} keyboardShouldPersistTaps="handled">
              {sidebarView}
            </ScrollView>
          </View>
        ) : (
          <ScrollView style={styles.grow} keyboardShouldPersistTaps="handled">
            {main}
            {sidebarView}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerMessage} role="alert">
            {message}
          </Text>
          <Button label="Cancel" onPress={onRequestClose} />
          <Button label={saveLabel} variant="primary" onPress={onSave} disabled={!canSave} />
        </View>
      </View>
      {children}
    </View>
  );

  if (guard === 'navigation') return page;
  // Not a screen, so a Modal of its own; Android's back button goes through the same question as ×.
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onRequestClose} statusBarTranslucent navigationBarTranslucent>
      {page}
    </Modal>
  );
}

interface LeaveDialogProps {
  /** "task", "entry", "note". */
  kind: string;
  isNew: boolean;
  /** Why the changes can't be saved; Save is then disabled. */
  problem: string | null;
  /** What is unsaved, when it's not the edits themselves (a typed sub-task name). */
  unsavedNote?: string;
  onSave: () => void;
  onAnswer: (leave: boolean) => void;
}

/** "Save changes?": Cancel (stay), Discard, and Save, which the modal does before leaving. */
export function LeaveDialog({ kind, isNew, problem, unsavedNote, onSave, onAnswer }: LeaveDialogProps) {
  return (
    <ConfirmDialog
      title={isNew ? `Add this ${kind}?` : 'Save changes?'}
      message={
        problem
          ? `${problem} Fix it to save, or discard the changes.`
          : (unsavedNote ?? (isNew ? `This ${kind} has not been added yet.` : `The changes you made to this ${kind} have not been saved.`))
      }
      confirmLabel={isNew ? `Add ${kind}` : 'Save'}
      confirmDisabled={Boolean(problem)}
      onConfirm={() => {
        onSave();
        onAnswer(true);
      }}
      onCancel={() => onAnswer(false)}
      alternative={{ label: 'Discard', onPress: () => onAnswer(true) }}
    />
  );
}

interface DateFieldProps {
  label: string;
  value: LocalDate | undefined;
  allDay: boolean;
  /** Color the summary by urgency (overdue, today...), as for due dates. */
  colored?: boolean;
  onChange: (value: LocalDate | undefined) => void;
}

export function DateField({ label, value, allDay, colored = false, onChange }: DateFieldProps) {
  const colors = useColors();
  const styles = useModalStyles();
  return (
    <View style={styles.dateField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inline}>
        <DatePicker
          value={value?.date}
          // The time counts too: a due time already passed today is overdue.
          tone={colored && value ? describeDue(value).tone : undefined}
          clearable
          aria-label={label}
          onChange={(date) => onChange(!date ? undefined : allDay ? { date } : { date, time: value?.time ?? DEFAULT_TIME })}
        />
        {!allDay && (
          <TimeField
            value={value && (value.time ?? DEFAULT_TIME)}
            aria-label={`${label} time`}
            // A time alone means today, as in Todoist.
            onChange={(time) => onChange({ date: value?.date ?? todayDate().date, time })}
          />
        )}
        {value && (
          <IconButton label={`Remove ${label.toLowerCase()}`} size={24} onPress={() => onChange(undefined)}>
            <CloseIcon color={colors.textTertiary} size={18} />
          </IconButton>
        )}
      </View>
    </View>
  );
}

interface MarkdownViewProps {
  /** What the field is, also its placeholder when empty. */
  label: string;
  /** Whether the text has formatting or links: a pencil then opens the editor too, as links take their own taps. */
  formatted: boolean;
  onEdit: () => void;
  children: ReactNode;
  /** The description's look (a taller box), rather than the title's. */
  description?: boolean;
  /** The empty description's height. */
  minHeight?: number;
}

/**
 * The formatted text of a field; a tap opens its editor (a tap on a link opens the link instead). On the web, text
 * with formatting or links only opens on a click in empty space, so its text can be selected and copied; the pencil
 * beside it opens the editor too.
 */
export function MarkdownView({ label, formatted, onEdit, children, description, minHeight = 60 }: MarkdownViewProps) {
  const colors = useColors();
  const styles = useModalStyles();
  return (
    <View style={styles.inlineTop}>
      <Pressable
        role="button"
        aria-label={`Edit ${label.toLowerCase()}`}
        onPress={(event) => {
          if (formatted && Platform.OS === 'web') {
            // A drag that selected text was for copying it.
            if (!window.getSelection()?.isCollapsed) return;
            const { pageX, pageY } = event.nativeEvent;
            if (isOverText(pageX - window.scrollX, pageY - window.scrollY)) return;
          }
          onEdit();
        }}
        style={[styles.field, styles.grow, description && { minHeight }]}
      >
        {children ?? <Text style={[description ? styles.descriptionText : styles.titleText, styles.muted]}>{label}</Text>}
      </Pressable>
      {formatted && (
        <IconButton label={`Edit ${label.toLowerCase()}`} size={24} onPress={onEdit} style={styles.pencil}>
          <PencilIcon color={colors.textTertiary} size={18} />
        </IconButton>
      )}
    </View>
  );
}

/**
 * Whether the point is on a character rather than in empty space (web only). The element under it can't tell: a
 * paragraph spans the whole width, past the end of a short line. So this finds the caret position there and checks
 * whether the character on either side of it covers the point.
 */
function isOverText(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false; // a key press, not a click
  const position = document.caretPositionFromPoint?.(x, y);
  const range = position ? undefined : document.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode ?? range?.startContainer;
  const offset = position?.offset ?? range?.startOffset ?? 0;
  if (!node || node.nodeType !== Node.TEXT_NODE) return false;
  const length = node.textContent?.length ?? 0;
  const character = document.createRange();
  for (const start of [offset - 1, offset]) {
    if (start < 0 || start >= length) continue;
    character.setStart(node, start);
    character.setEnd(node, start + 1);
    for (const rect of character.getClientRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
  }
  return false;
}

/** A text box that grows with its text (the web doesn't do it on its own), for descriptions. */
export function DescriptionInput({
  value,
  onChangeText,
  onDone,
  placeholder,
  label,
  minHeight = 60,
}: {
  value: string;
  onChangeText: (text: string) => void;
  /** The editor is left: the text shows formatted again. */
  onDone: () => void;
  placeholder: string;
  label: string;
  minHeight?: number;
}) {
  const colors = useColors();
  const styles = useModalStyles();
  const [height, setHeight] = useState(minHeight);
  return (
    <TextInput
      style={[styles.descriptionInput, styles.field, { borderColor: colors.textTertiary, height: Math.max(minHeight, height) }]}
      value={value}
      onChangeText={onChangeText}
      onContentSizeChange={(event) => setHeight(event.nativeEvent.contentSize.height + 8)}
      {...useEditor(value, onDone)}
      placeholder={placeholder}
      placeholderTextColor={colors.textTertiary}
      aria-label={label}
      multiline
      textAlignVertical="top"
    />
  );
}

/** The name or title's editor. */
export function TitleInput({
  value,
  onChangeText,
  onDone,
  label,
}: {
  value: string;
  onChangeText: (text: string) => void;
  /** The editor is left: the text shows formatted again. */
  onDone: () => void;
  label: string;
}) {
  const colors = useColors();
  const styles = useModalStyles();
  return (
    <TextInput
      style={[styles.titleInput, styles.field, { borderColor: colors.textTertiary }]}
      value={value}
      onChangeText={onChangeText}
      {...useEditor(value, onDone)}
      placeholder={label}
      placeholderTextColor={colors.textTertiary}
      aria-label={label}
      submitBehavior="blurAndSubmit"
      returnKeyType="done"
    />
  );
}

/**
 * What both editors share: they open with the focus and the caret at the end of the text (the selection is only
 * set until it first changes, then left to the user), and close when left. Switching to another window doesn't
 * count on the web: the field stays open and the browser gives it back its focus on return.
 */
function useEditor(value: string, onDone: () => void): TextInputProps {
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>({
    start: value.length,
    end: value.length,
  });
  return {
    autoFocus: true,
    selection,
    onSelectionChange: () => setSelection(undefined),
    onBlur: () => {
      if (Platform.OS !== 'web' || document.hasFocus()) onDone();
    },
  };
}

export function SidebarItem({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const styles = useModalStyles();
  return (
    <View style={styles.sidebarItem}>
      <View style={styles.sidebarItemHeader}>
        <Text style={styles.sidebarTitle} role="heading">
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** The calendar a new item goes in (a selector when there are several), or the one it is in. */
export function CalendarField({
  label,
  calendar,
  calendars,
  canPick,
  onChange,
}: {
  label: string;
  calendar: Calendar;
  calendars: Calendar[];
  canPick: boolean;
  onChange: (calendar: Calendar) => void;
}) {
  const colors = useColors();
  const styles = useModalStyles();
  if (canPick) {
    return (
      <Select
        aria-label={label}
        value={calendar.href}
        onChange={(href) => onChange(calendars.find((c) => c.href === href) ?? calendar)}
        options={calendars.map((c) => ({ value: c.href, label: c.name, icon: <HashIcon color={c.color ?? colors.textSecondary} /> }))}
      />
    );
  }
  return (
    <View style={styles.inline}>
      <HashIcon color={calendar.color ?? colors.textTertiary} />
      <Text style={styles.value}>{calendar.name}</Text>
    </View>
  );
}

/** Labels typed as one comma-separated line. */
export function LabelsInput({ initial, onChange }: { initial: string[]; onChange: (labels: string[]) => void }) {
  const colors = useColors();
  const styles = useModalStyles();
  const [text, setText] = useState(() => initial.join(', '));
  return (
    <TextInput
      style={styles.textInput}
      value={text}
      onChangeText={(next) => {
        setText(next);
        onChange(next.split(',').map((l) => l.trim()).filter(Boolean));
      }}
      placeholder="Comma separated"
      placeholderTextColor={colors.textTertiary}
      aria-label="Labels"
      autoCapitalize="none"
    />
  );
}

/** Google Maps URLs need no API key; nothing is sent to Google until the user opens the link. */
const mapUrl = (location: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;

/** Free-text location, with a button that opens it in Google Maps. */
export function LocationInput({ value, onChange }: { value: string; onChange: (location: string) => void }) {
  const colors = useColors();
  const styles = useModalStyles();
  return (
    <View style={styles.inline}>
      <TextInput
        style={[styles.textInput, styles.grow]}
        value={value}
        onChangeText={onChange}
        placeholder="Address or place"
        placeholderTextColor={colors.textTertiary}
        aria-label="Location"
      />
      {value.trim() !== '' && (
        <IconButton label="Open in Google Maps" onPress={() => void Linking.openURL(mapUrl(value.trim()))}>
          <MapPinIcon color={colors.textSecondary} size={20} />
        </IconButton>
      )}
    </View>
  );
}

/** The "Details" item: what other apps wrote that the modal doesn't edit, plus dates. */
export function Details({
  rows,
  url,
  created,
  lastModified,
}: {
  rows?: [term: string, value: string][];
  url?: string;
  created?: Date;
  lastModified?: Date;
}) {
  const colors = useColors();
  const all: [string, ReactNode][] = [...(rows ?? [])];
  if (url) {
    all.push([
      'Link',
      // Only http(s) becomes a link: a calendar object could carry a javascript: URL.
      /^https?:\/\//i.test(url) ? (
        <Text style={{ color: colors.link }} role="link" onPress={() => void Linking.openURL(url)}>
          {url}
        </Text>
      ) : (
        url
      ),
    ]);
  }
  if (created) all.push(['Created', formatDateTime(created)]);
  if (lastModified) all.push(['Modified', formatDateTime(lastModified)]);
  if (all.length === 0) return null;
  return (
    <SidebarItem title="Details">
      {all.map(([term, value]) => (
        <Detail key={term} term={term}>
          {value}
        </Detail>
      ))}
    </SidebarItem>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  const styles = useModalStyles();
  return (
    <View style={styles.detail}>
      <Text style={styles.detailTerm}>{term}</Text>
      <Text style={styles.detailValue}>{children}</Text>
    </View>
  );
}

/** The item's UID in small print, selectable for copying. */
export function UidLine({ uid }: { uid: string }) {
  const styles = useModalStyles();
  return (
    <Text style={styles.uid} selectable>
      UID {uid}
    </Text>
  );
}

export function useModalStyles() {
  return makeStyles(useColors());
}

const makeStyles = (colors: Colors) => {
  const titleText: TextStyle = { fontSize: 20, fontWeight: '700', lineHeight: 30, color: colors.text };
  const descriptionText: TextStyle = { fontSize: 14, lineHeight: 21, color: colors.text };
  return StyleSheet.create({
    backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.bg },
    backdropWide: {
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingTop: '7%',
      paddingHorizontal: 16,
      paddingBottom: 16,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    modal: { backgroundColor: colors.bg, overflow: 'hidden' },
    modalWide: {
      width: '100%',
      maxWidth: 864,
      maxHeight: '86%',
      borderRadius: 10,
      boxShadow: '0 15px 50px rgba(0, 0, 0, 0.35)',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingVertical: 8,
      paddingLeft: 16,
      paddingRight: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    crumb: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
    crumbText: { fontSize: 13, color: colors.textSecondary, flexShrink: 1 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    contentWide: { flexDirection: 'row', flexShrink: 1, minHeight: 0 },
    grow: { flex: 1, minWidth: 0 },
    main: { paddingTop: 16, paddingBottom: 24, paddingLeft: 16, paddingRight: 24 },
    editor: { flex: 1, minWidth: 0, gap: 4 },
    field: { borderWidth: 1, borderColor: 'transparent', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    titleText,
    titleInput: { ...titleText, outlineWidth: 0 },
    descriptionText,
    descriptionInput: { ...descriptionText, outlineWidth: 0 },
    inlineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
    pencil: { marginTop: 4 },
    muted: { color: colors.textTertiary },
    sidebar: { backgroundColor: colors.bgSoft, paddingHorizontal: 24, paddingVertical: 16 },
    sidebarWide: { minHeight: '100%' },
    sidebarNarrow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, paddingHorizontal: 16 },
    sidebarScroll: {
      width: 300,
      flexGrow: 0,
      backgroundColor: colors.bgSoft,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.divider,
    },
    sidebarItem: {
      paddingTop: 8,
      paddingBottom: 12,
      gap: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    sidebarItemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
    sidebarTitle: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
    switches: { flexDirection: 'row', gap: 10 },
    inline: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    value: { fontSize: 14, color: colors.text },
    note: { fontSize: 12, flexShrink: 1, color: colors.textTertiary },
    dateField: { gap: 4 },
    fieldLabel: { fontSize: 12, color: colors.textTertiary },
    textInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      backgroundColor: colors.bg,
      paddingHorizontal: 8,
      paddingVertical: 6,
      fontSize: 13,
      color: colors.text,
      outlineWidth: 0,
    },
    detail: { flexDirection: 'row', gap: 8 },
    detailTerm: { width: 70, fontSize: 12, color: colors.textTertiary },
    detailValue: { flex: 1, fontSize: 12, color: colors.text },
    uid: { marginTop: 12, fontSize: 11, color: colors.textTertiary },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      backgroundColor: colors.bg,
    },
    footerMessage: { flex: 1, minWidth: 0, fontSize: 13, color: colors.p1 },
  });
};
