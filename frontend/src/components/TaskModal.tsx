import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
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
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Calendar } from '../api/caldav.ts';
import { sameDate, type LocalDate, type Priority, type Task, type TaskEdits } from '../api/tasks.ts';
// No extension: the bundler picks download.native.ts on Android/iOS.
import { download } from '../download';
import { fileName } from '../fileName.ts';
import { describeDue, formatDateTime } from '../format.ts';
import { hasMarkdown, InlineMarkdown, Markdown, plainText } from '../markdown.tsx';
import { setLeaveGuard } from '../leaveGuard.ts';
import { addDaysTo, daysBetween, firstOccurrence, moveRule, repeatProblem, todayDate, withUntilFor } from '../repeat.ts';
import { useColors, type Colors } from '../theme.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { DatePicker } from './DatePicker.tsx';
import {
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  FlagIcon,
  HashIcon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  RepeatIcon,
  TrashIcon,
} from './icons.tsx';
import { Menu, type MenuItem } from './Menu.tsx';
import { RepeatField } from './RepeatField.tsx';
import { Select } from './Select.tsx';
import { dueColor, priorityColor, TaskCheckbox } from './TaskItem.tsx';
import { TimeField } from './TimeField.tsx';
import { Button, IconButton, SwitchRow } from './ui.tsx';

interface Props {
  /** The task to show and edit; absent when adding a new one. */
  task?: Task;
  /** The task this one is a sub-task of. */
  parent?: Task;
  /** Direct sub-tasks, in the order to show them. */
  subtasks?: Task[];
  /** The task's list; for a new task, the one chosen at first. */
  calendar: Calendar;
  /** The lists a new task can go in; with more than one, the modal lets the user pick. */
  calendars?: Calendar[];
  /**
   * How leaving is guarded when something is unsaved. `navigation`: the modal is a screen (/tasks/<uid>), and every
   * way of leaving it (its buttons, Android's back button, the browser's Back) goes through the navigator, which
   * asks first. `self`: the modal is not a screen (a new task), and its own ways out ask.
   */
  guard: 'navigation' | 'self';
  /** Leaves the modal: goes back to the list. */
  onClose: () => void;
  /** Takes the edits and the list the task is in (for a new task, the one picked); the save runs in the background. */
  onSave: (edits: TaskEdits, calendarHref: string) => void;
  /** Completes an open task or reopens a completed one; a repeating task moves to its next date instead. */
  onToggle: (task: Task) => void;
  /** Completes a repeating task for good instead of moving it to its next date. */
  onCompleteForGood?: (task: Task) => void;
  /** Deletes the task and its sub-tasks, once the user has confirmed. */
  onDelete?: (task: Task) => void;
  /** Sub-tasks at any depth, which deleting the task deletes too. */
  descendantCount?: number;
  /** Shows another task (a parent or a sub-task) in place of this one. */
  onOpenTask?: (task: Task) => void;
  /** Adds an open sub-task with this name; the save runs in the background. */
  onAddSubtask?: (summary: string) => void;
}

const PRIORITIES: Priority[] = [1, 2, 3, 4];
/** Time given to a date when "All day" is switched off. */
const DEFAULT_TIME = '09:00';
/** From this width the details go in a sidebar next to the task, as on a computer. */
const WIDE = 768;

function initialEdits(task: Task | undefined): TaskEdits {
  if (!task) return { summary: '', description: '', priority: 4, categories: [], location: '' };
  return {
    summary: task.summary,
    description: task.description,
    start: task.start,
    due: task.due,
    priority: task.priority,
    categories: task.categories,
    location: task.location ?? '',
    recurrence: task.recurrence,
  };
}

function sameEdits(a: TaskEdits, b: TaskEdits): boolean {
  return (
    a.summary === b.summary &&
    a.description === b.description &&
    sameDate(a.start, b.start) &&
    sameDate(a.due, b.due) &&
    a.priority === b.priority &&
    a.categories.join('\n') === b.categories.join('\n') &&
    a.location === b.location &&
    a.recurrence === b.recurrence
  );
}

/** Google Maps URLs need no API key; nothing is sent to Google until the user opens the link. */
const mapUrl = (location: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;

/** All-day dates carry no time; timed dates always carry one. */
function inMode(date: LocalDate | undefined, allDay: boolean): LocalDate | undefined {
  if (!date) return undefined;
  return allDay ? { date: date.date } : { date: date.date, time: date.time ?? DEFAULT_TIME };
}

const sortKey = (date: LocalDate) => `${date.date}T${date.time ?? '00:00'}`;

function problemWith(edits: TaskEdits): string | null {
  if (!edits.summary.trim()) return 'The task needs a name.';
  if (edits.start && edits.due && sortKey(edits.start) > sortKey(edits.due)) {
    return 'The start date must be before the due date.';
  }
  return edits.recurrence ? repeatProblem(edits.recurrence, edits.start ?? edits.due) : null;
}

export function TaskModal({
  task,
  parent,
  subtasks = [],
  calendar: initialCalendar,
  calendars = [],
  guard,
  onClose,
  onSave,
  onToggle,
  onCompleteForGood,
  onDelete,
  descendantCount = 0,
  onOpenTask,
  onAddSubtask,
}: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const isNew = task === undefined;
  const [calendar, setCalendar] = useState(initialCalendar);
  const canPickCalendar = isNew && calendars.length > 1;
  const [edits, setEdits] = useState(() => initialEdits(task));
  const [allDay, setAllDay] = useState(() => !task?.start?.time && !task?.due?.time);
  const [labelsText, setLabelsText] = useState(() => task?.categories.join(', ') ?? '');
  // The name and description show as formatted Markdown, and turn into their editor when tapped, like Todoist.
  // A new task starts with the name being typed.
  const [editing, setEditing] = useState<'summary' | 'description' | null>(isNew ? 'summary' : null);

  const update = (patch: Partial<TaskEdits>) => setEdits((current) => ({ ...current, ...patch }));
  const dirty = !sameEdits(edits, initialEdits(task));
  // What gets saved: both dates brought to the chosen mode (RFC 5545 wants DTSTART and DUE of the same type,
  // and the repeat's UNTIL of that type too).
  const finalEdits: TaskEdits = {
    ...edits,
    start: inMode(edits.start, allDay),
    due: inMode(edits.due, allDay),
    recurrence: edits.recurrence && withUntilFor(edits.recurrence, allDay),
  };
  const repeatAnchor = finalEdits.start ?? finalEdits.due ?? todayDate();
  const problem = problemWith(finalEdits);
  const canSave = dirty && !problem;

  // A sub-task name typed but not added yet is unsaved work too, though Save does not add it.
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const guarded = dirty || subtaskDraft.trim() !== '';

  /** Most tasks only have a due date: the start date's field shows only for tasks that have one, or on request. */
  const [showStart, setShowStart] = useState(() => task?.start !== undefined);

  function toggleStart(next: boolean) {
    setShowStart(next);
    if (!next && edits.start) changeDate('start', undefined);
  }

  function toggleAllDay(next: boolean) {
    setAllDay(next);
    update({ start: inMode(edits.start, next), due: inMode(edits.due, next) });
  }

  /** A new date also moves a repeat that follows it ("every week on Friday" becomes Monday's). */
  function changeDate(field: 'start' | 'due', value: LocalDate | undefined) {
    const from = edits.start ?? edits.due;
    const to = field === 'start' ? (value ?? edits.due) : (edits.start ?? value);
    const { recurrence } = edits;
    update({ [field]: value, recurrence: recurrence && from && to ? moveRule(recurrence, from, to, allDay) : recurrence });
  }

  function changeRepeat(recurrence: string | undefined) {
    if (!recurrence) return update({ recurrence });
    // As in Todoist, a repeat on a task without a date starts today...
    const due = edits.start || edits.due ? edits.due : inMode(todayDate(), allDay);
    // ...and on its first occurrence: "every Monday" chosen on a Friday moves the task to Monday.
    const anchor = edits.start ?? due!;
    const shift = daysBetween(anchor, firstOccurrence(recurrence, anchor));
    update({ recurrence, start: addDaysTo(edits.start, shift), due: addDaysTo(due, shift) });
  }

  // Leaving with something unsaved asks first. The question only says whether to go on leaving; saving, when
  // chosen, is done by the dialog itself.
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  /** Set when the modal leaves on purpose (after saving, deleting...), so the navigator lets it go unasked. */
  const leavingOnPurpose = useRef(false);

  function askThen(go: () => void) {
    setPendingLeave(() => go);
  }

  usePreventRemove(guard === 'navigation' && guarded, ({ data }) => {
    const go = () => navigation.dispatch(data.action);
    if (leavingOnPurpose.current) go();
    else askThen(go);
  });

  // The browser's Back and Forward don't reach usePreventRemove: while something is unsaved, leaveGuard.ts keeps
  // the router from seeing them, and this puts the task's entry back and asks. Leaving then goes back the usual way.
  // A reload or closing the tab can only get the browser's own prompt.
  useEffect(() => {
    if (Platform.OS !== 'web' || guard !== 'navigation' || !guarded) return;
    const entry = { state: window.history.state as unknown, url: window.location.href };
    setLeaveGuard(() => {
      if (leavingOnPurpose.current) return false; // the modal's own way out, already asked or nothing to ask
      window.history.pushState(entry.state, '', entry.url);
      askThen(onClose);
      return true;
    });
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [guard, guarded, onClose]);

  /** Leaves after an action that leaves nothing to ask about. */
  function leaveNow(go: () => void = onClose) {
    leavingOnPurpose.current = true;
    go();
  }

  /** The modal's own ways out (×, Cancel, the backdrop, Escape). As a screen, the navigator asks if needed. */
  function requestClose() {
    if (guard === 'self' && guarded) askThen(onClose);
    else onClose();
  }

  /** Everything unsaved, sub-task name included, is kept, and then the modal is left as asked. */
  function saveAndLeave() {
    if (dirty) onSave(finalEdits, calendar.href);
    if (subtaskDraft.trim()) addSubtask();
    const go = pendingLeave;
    setPendingLeave(null);
    if (go) leaveNow(go);
  }

  function discardAndLeave() {
    const go = pendingLeave;
    setPendingLeave(null);
    if (go) leaveNow(go);
  }

  // Asks here in both modes: the router may show the other task in this same screen, which the navigator
  // wouldn't see as leaving.
  const openOther =
    onOpenTask && ((other: Task) => (guarded ? askThen(() => onOpenTask(other)) : leaveNow(() => onOpenTask(other))));

  function addSubtask() {
    const summary = subtaskDraft.trim();
    if (!summary || !onAddSubtask) return;
    onAddSubtask(summary);
    setSubtaskDraft(''); // stays open for the next one, like Todoist
  }

  function stopAddingSubtask() {
    setAddingSubtask(false);
    setSubtaskDraft('');
  }

  function save() {
    if (!canSave) return;
    onSave(finalEdits, calendar.href);
    leaveNow();
  }

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /** The three-dots menu in the header: actions that are rarely needed or can't be taken back as easily. */
  const menuItems: MenuItem[] = [];
  if (task?.recurrence && !task.completed && onCompleteForGood) {
    menuItems.push({
      label: 'Complete for good',
      icon: (color) => <CheckIcon color={color} size={16} />,
      onSelect: () => {
        onCompleteForGood(task);
        leaveNow();
      },
    });
  }
  if (task) {
    // The file as stored on the server (reminders, repeats and overrides included), not the unsaved edits.
    menuItems.push({
      label: 'Download as .ics',
      icon: (color) => <DownloadIcon color={color} size={18} />,
      onSelect: () => void download(fileName(plainText(task.summary), 'ics', 'task'), task.ics, 'text/calendar').catch(() => {}),
    });
  }
  if (task && onDelete) {
    menuItems.push({ label: 'Delete', icon: (color) => <TrashIcon color={color} />, danger: true, onSelect: () => setConfirmingDelete(true) });
  }

  // Keyboard shortcuts on the web: Escape closes, Ctrl/⌘+Enter saves.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (pendingLeave || confirmingDelete) return; // the dialog on top owns the keyboard
      if (event.key === 'Escape') requestClose();
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The description box grows with its text, like Todoist (the web doesn't do it on its own).
  const [descriptionHeight, setDescriptionHeight] = useState(60);
  const message = dirty ? problem : null;
  const headerColor = calendar.color ?? colors.textTertiary;

  const main = (
    <View style={styles.main}>
      <View style={styles.titleRow}>
        <View style={styles.titleCheck}>
          {task ? (
            <TaskCheckbox
              task={{ ...task, priority: edits.priority }}
              onToggle={(toggled) => {
                onToggle(toggled);
                leaveNow();
              }}
            />
          ) : (
            // Nothing to complete yet: just the circle, in the chosen priority color.
            <View
              aria-hidden
              style={[
                styles.staticCheck,
                { borderColor: priorityColor(colors, edits.priority), borderWidth: edits.priority === 4 ? 1 : 2 },
              ]}
            />
          )}
        </View>
        <View style={styles.editor}>
          {editing === 'summary' ? (
            <TextInput
              style={[styles.titleInput, styles.field, { borderColor: colors.textTertiary }]}
              value={edits.summary}
              onChangeText={(summary) => update({ summary })}
              onBlur={() => setEditing(null)}
              placeholder="Task name"
              placeholderTextColor={colors.textTertiary}
              aria-label="Task name"
              autoFocus
              submitBehavior="blurAndSubmit"
              returnKeyType="done"
            />
          ) : (
            <MarkdownView label="Task name" formatted={hasMarkdown(edits.summary)} onEdit={() => setEditing('summary')} styles={styles}>
              {edits.summary ? (
                <Text style={styles.titleText}>
                  <InlineMarkdown text={edits.summary} />
                </Text>
              ) : null}
            </MarkdownView>
          )}
          {editing === 'description' ? (
            <TextInput
              style={[styles.descriptionInput, styles.field, { borderColor: colors.textTertiary, height: Math.max(60, descriptionHeight) }]}
              value={edits.description}
              onChangeText={(description) => update({ description })}
              onContentSizeChange={(event) => setDescriptionHeight(event.nativeEvent.contentSize.height + 8)}
              onBlur={() => setEditing(null)}
              placeholder="Description"
              placeholderTextColor={colors.textTertiary}
              aria-label="Description"
              autoFocus
              multiline
              textAlignVertical="top"
            />
          ) : (
            <MarkdownView
              label="Description"
              formatted={hasMarkdown(edits.description, true)}
              onEdit={() => setEditing('description')}
              styles={styles}
              description
            >
              {edits.description.trim() ? <Markdown text={edits.description} style={styles.descriptionText} /> : null}
            </MarkdownView>
          )}
        </View>
      </View>

      {task && onAddSubtask && (
        <View style={styles.subtasks} aria-label="Sub-tasks">
          {subtasks.length > 0 && (
            <>
              <Text style={styles.subtasksTitle}>
                Sub-tasks{'  '}
                <Text style={styles.muted}>
                  {subtasks.filter((s) => s.completed).length}/{subtasks.length}
                </Text>
              </Text>
              {subtasks.map((subtask) => (
                // Keyed on the state too, so the checkbox starts over if a failed save flips it back.
                <SubtaskRow
                  key={`${subtask.href} ${subtask.completed}`}
                  task={subtask}
                  onOpen={openOther}
                  onToggle={onToggle}
                  styles={styles}
                />
              ))}
            </>
          )}
          {addingSubtask ? (
            <View style={styles.subtaskAdd}>
              <TextInput
                style={[styles.subtaskInput, { borderColor: colors.border }]}
                value={subtaskDraft}
                onChangeText={setSubtaskDraft}
                onSubmitEditing={addSubtask}
                submitBehavior="submit"
                returnKeyType="done"
                placeholder="Sub-task name"
                placeholderTextColor={colors.textTertiary}
                aria-label="Sub-task name"
                autoFocus
              />
              <Button label="Cancel" onPress={stopAddingSubtask} />
              <Button label="Add" variant="primary" onPress={addSubtask} disabled={!subtaskDraft.trim()} />
            </View>
          ) : (
            <Pressable role="button" onPress={() => setAddingSubtask(true)} style={styles.addRow}>
              <PlusIcon color={colors.accent} />
              <Text style={styles.addText}>Add sub-task</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );

  const sidebar = (
    <View style={[styles.sidebar, wide ? styles.sidebarWide : styles.sidebarNarrow]}>
      <SidebarItem title="Project" styles={styles}>
        {canPickCalendar ? (
          <Select
            aria-label="Project"
            value={calendar.href}
            onChange={(href) => setCalendar(calendars.find((c) => c.href === href) ?? calendar)}
            options={calendars.map((c) => ({
              value: c.href,
              label: c.name,
              icon: <HashIcon color={c.color ?? colors.textSecondary} />,
            }))}
          />
        ) : (
          <View style={styles.inline}>
            <HashIcon color={headerColor} />
            <Text style={styles.value}>{calendar.name}</Text>
          </View>
        )}
      </SidebarItem>

      <SidebarItem
        title="Dates"
        styles={styles}
        action={
          <View style={styles.switches}>
            <SwitchRow label="All day" value={allDay} onChange={toggleAllDay} />
            <SwitchRow label="Start date" value={showStart} onChange={toggleStart} />
          </View>
        }
      >
        {showStart && (
          <DateField label="Start date" value={edits.start} allDay={allDay} onChange={(start) => changeDate('start', start)} styles={styles} />
        )}
        <DateField label="Due date" value={edits.due} allDay={allDay} colored onChange={(due) => changeDate('due', due)} styles={styles} />
        <RepeatField value={edits.recurrence} anchor={repeatAnchor} allDay={allDay} onChange={changeRepeat} />
        {edits.recurrence && !edits.start && !edits.due && (
          <View style={styles.inline}>
            <RepeatIcon color={colors.dueTomorrow} />
            <Text style={[styles.note, { color: colors.dueTomorrow }]}>Without a date, the repeat is removed too.</Text>
          </View>
        )}
      </SidebarItem>

      <SidebarItem title="Priority" styles={styles}>
        <View style={styles.priorities} role="radiogroup" aria-label="Priority">
          {PRIORITIES.map((p) => {
            const chosen = edits.priority === p;
            return (
              <Pressable
                key={p}
                role="radio"
                aria-checked={chosen}
                aria-label={`Priority ${p}`}
                onPress={() => update({ priority: p })}
                style={({ pressed, hovered }) => [
                  styles.priority,
                  { borderColor: chosen ? priorityColor(colors, p) : 'transparent' },
                  (pressed || hovered) && !chosen && { backgroundColor: colors.bgHover },
                ]}
              >
                <FlagIcon color={priorityColor(colors, p)} />
              </Pressable>
            );
          })}
        </View>
      </SidebarItem>

      <SidebarItem title="Labels" styles={styles}>
        <TextInput
          style={styles.textInput}
          value={labelsText}
          onChangeText={(text) => {
            setLabelsText(text);
            update({ categories: text.split(',').map((l) => l.trim()).filter(Boolean) });
          }}
          placeholder="Comma separated"
          placeholderTextColor={colors.textTertiary}
          aria-label="Labels"
          autoCapitalize="none"
        />
      </SidebarItem>

      <SidebarItem title="Location" styles={styles}>
        <View style={styles.inline}>
          <TextInput
            style={[styles.textInput, styles.grow]}
            value={edits.location}
            onChangeText={(location) => update({ location })}
            placeholder="Address or place"
            placeholderTextColor={colors.textTertiary}
            aria-label="Location"
          />
          {edits.location.trim() !== '' && (
            <IconButton label="Open in Google Maps" onPress={() => void Linking.openURL(mapUrl(edits.location.trim()))}>
              <MapPinIcon color={colors.textSecondary} size={20} />
            </IconButton>
          )}
        </View>
      </SidebarItem>

      {task && hasDetails(task) && (
        <SidebarItem title="Details" styles={styles}>
          {task.status && <Detail term="Status" styles={styles}>{task.status.toLowerCase().replace('-', ' ')}</Detail>}
          {task.percentComplete !== undefined && (
            <Detail term="Progress" styles={styles}>
              {task.percentComplete}%
            </Detail>
          )}
          {task.url && (
            <Detail term="Link" styles={styles}>
              {/* Only http(s) becomes a link: a task could carry a javascript: URL. */}
              {/^https?:\/\//i.test(task.url) ? (
                <Text style={{ color: colors.link }} role="link" onPress={() => void Linking.openURL(task.url!)}>
                  {task.url}
                </Text>
              ) : (
                task.url
              )}
            </Detail>
          )}
          {task.created && <Detail term="Created" styles={styles}>{formatDateTime(task.created)}</Detail>}
          {task.lastModified && <Detail term="Modified" styles={styles}>{formatDateTime(task.lastModified)}</Detail>}
        </SidebarItem>
      )}

      {task && (
        <Text style={styles.uid} selectable>
          UID {task.uid}
        </Text>
      )}
    </View>
  );

  const page = (
    <View style={[styles.backdrop, wide ? styles.backdropWide : null]}>
      {wide && <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} aria-label="Close" />}
      <View
        role="dialog"
        aria-modal
        aria-label={isNew ? 'Add task' : 'Task details'}
        style={[
          styles.modal,
          wide ? styles.modalWide : { flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.crumb}>
            <HashIcon color={headerColor} size={14} />
            <Text style={styles.crumbText} numberOfLines={1}>
              {calendar.name}
            </Text>
            {parent && openOther && (
              <>
                <Text style={styles.muted} aria-hidden>
                  /
                </Text>
                <Pressable role="link" aria-label="Open the parent task" onPress={() => openOther(parent)} style={styles.crumbLink}>
                  <Text style={styles.crumbText} numberOfLines={1}>
                    {plainText(parent.summary) || 'Untitled task'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
          <View style={styles.headerActions}>
            {menuItems.length > 0 && <Menu aria-label="More actions" items={menuItems} />}
            <IconButton label="Close" onPress={requestClose}>
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
              {sidebar}
            </ScrollView>
          </View>
        ) : (
          <ScrollView style={styles.grow} keyboardShouldPersistTaps="handled">
            {main}
            {sidebar}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerMessage} role="alert">
            {message}
          </Text>
          <Button label="Cancel" onPress={requestClose} />
          <Button label={isNew ? 'Add task' : 'Save'} variant="primary" onPress={save} disabled={!canSave} />
        </View>
      </View>

      {pendingLeave && (
        <ConfirmDialog
          title={isNew ? 'Add this task?' : 'Save changes?'}
          message={
            dirty && problem
              ? `${problem} Fix it to save, or discard the changes.`
              : isNew
                ? 'This task has not been added yet.'
                : dirty
                  ? 'The changes you made to this task have not been saved.'
                  : 'The sub-task you typed has not been added.'
          }
          confirmLabel={isNew ? 'Add task' : 'Save'}
          confirmDisabled={dirty && Boolean(problem)}
          onConfirm={saveAndLeave}
          onCancel={() => setPendingLeave(null)}
          alternative={{ label: 'Discard', onPress: discardAndLeave }}
        />
      )}

      {confirmingDelete && task && onDelete && (
        <ConfirmDialog
          title="Delete task?"
          message={`“${plainText(task.summary) || 'Untitled task'}”${
            descendantCount > 0
              ? ` and its ${descendantCount} sub-task${descendantCount === 1 ? '' : 's'} will be deleted.`
              : ' will be deleted.'
          }`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            // Unsaved edits go with it: there is nothing left to save them to.
            setConfirmingDelete(false);
            leaveNow();
            onDelete(task);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </View>
  );

  if (guard === 'navigation') return page;
  // Not a screen, so a Modal of its own; Android's back button goes through the same question as ×.
  return (
    <Modal transparent visible animationType="fade" onRequestClose={requestClose} statusBarTranslucent navigationBarTranslucent>
      {page}
    </Modal>
  );
}

type Styles = ReturnType<typeof makeStyles>;

interface DateFieldProps {
  label: string;
  value: LocalDate | undefined;
  allDay: boolean;
  /** Color the summary by urgency (overdue, today...), as for due dates. */
  colored?: boolean;
  onChange: (value: LocalDate | undefined) => void;
  styles: Styles;
}

function DateField({ label, value, allDay, colored = false, onChange, styles }: DateFieldProps) {
  const colors = useColors();
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

function SubtaskRow({
  task,
  onOpen,
  onToggle,
  styles,
}: {
  task: Task;
  onOpen?: (task: Task) => void;
  onToggle: (task: Task) => void;
  styles: Styles;
}) {
  const colors = useColors();
  const due = task.due && describeDue(task.due);
  return (
    <Pressable onPress={() => onOpen?.(task)} style={styles.subtask}>
      <TaskCheckbox task={task} onToggle={onToggle} />
      <Text style={[styles.subtaskTitle, task.completed && styles.struck]}>
        {task.summary ? <InlineMarkdown text={task.summary} /> : <Text style={styles.muted}>Untitled task</Text>}
      </Text>
      {due && (
        <View style={styles.inline}>
          <Text style={{ fontSize: 12, color: task.completed ? colors.textTertiary : dueColor(colors, due.tone) }}>{due.label}</Text>
          {task.recurrence && <RepeatIcon color={task.completed ? colors.textTertiary : dueColor(colors, due.tone)} />}
        </View>
      )}
    </Pressable>
  );
}

interface MarkdownViewProps {
  /** What the field is, also its placeholder when empty. */
  label: string;
  /** Whether the text has formatting or links: a pencil then opens the editor too, as links take their own taps. */
  formatted: boolean;
  onEdit: () => void;
  children: ReactNode;
  styles: Styles;
  description?: boolean;
}

/** The formatted text of a field; a tap opens its editor (a tap on a link opens the link instead). */
function MarkdownView({ label, formatted, onEdit, children, styles, description }: MarkdownViewProps) {
  const colors = useColors();
  return (
    <View style={styles.inlineTop}>
      <Pressable
        role="button"
        aria-label={`Edit ${label.toLowerCase()}`}
        onPress={onEdit}
        style={[styles.field, styles.grow, description && styles.descriptionView]}
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

function hasDetails(task: Task): boolean {
  return Boolean(task.status || task.percentComplete !== undefined || task.url || task.created || task.lastModified);
}

function SidebarItem({ title, action, children, styles }: { title: string; action?: ReactNode; children: ReactNode; styles: Styles }) {
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

function Detail({ term, children, styles }: { term: string; children: ReactNode; styles: Styles }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailTerm}>{term}</Text>
      <Text style={styles.detailValue}>{children}</Text>
    </View>
  );
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
      elevation: 16,
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 25,
      shadowOffset: { width: 0, height: 15 },
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
    crumbLink: { flexShrink: 1, minWidth: 0, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    contentWide: { flexDirection: 'row', flexShrink: 1, minHeight: 0 },
    grow: { flex: 1, minWidth: 0 },
    main: { paddingTop: 16, paddingBottom: 24, paddingLeft: 16, paddingRight: 24 },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    titleCheck: { marginTop: 6 },
    staticCheck: { width: 18, height: 18, borderRadius: 9, marginTop: 2 },
    editor: { flex: 1, minWidth: 0, gap: 4 },
    field: { borderWidth: 1, borderColor: 'transparent', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    titleText,
    titleInput: { ...titleText, outlineWidth: 0 },
    descriptionText,
    descriptionView: { minHeight: 60 },
    descriptionInput: { ...descriptionText, outlineWidth: 0 },
    inlineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
    pencil: { marginTop: 4 },
    muted: { color: colors.textTertiary },
    struck: { textDecorationLine: 'line-through', color: colors.textTertiary },
    subtasks: { marginTop: 16, paddingLeft: 26 },
    subtasksTitle: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
    subtask: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    subtaskTitle: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 21, color: colors.text },
    subtaskAdd: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
    subtaskInput: {
      flex: 1,
      minWidth: 0,
      borderWidth: 1,
      borderRadius: 5,
      paddingHorizontal: 8,
      paddingVertical: 6,
      fontSize: 14,
      color: colors.text,
      outlineWidth: 0,
    },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    addText: { fontSize: 14, color: colors.textTertiary },
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
    sidebarItem: { paddingTop: 8, paddingBottom: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    sidebarItemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
    sidebarTitle: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
    switches: { flexDirection: 'row', gap: 10 },
    inline: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    value: { fontSize: 14, color: colors.text },
    note: { fontSize: 12, flexShrink: 1 },
    dateField: { gap: 4 },
    fieldLabel: { fontSize: 12, color: colors.textTertiary },
    priorities: { flexDirection: 'row', gap: 4 },
    priority: { width: 34, height: 34, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
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
