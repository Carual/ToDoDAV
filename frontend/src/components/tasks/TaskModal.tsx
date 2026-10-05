import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Calendar } from '../../api/caldav.ts';
import { sameDate, type LocalDate } from '../../api/ical.ts';
import type { Priority, Task, TaskEdits } from '../../api/tasks.ts';
// No extension: the bundler picks download.native.ts on Android/iOS.
import { download } from '../../lib/download';
import { fileName } from '../../lib/fileName.ts';
import { describeDue } from '../../lib/format.ts';
import { hasMarkdown, InlineMarkdown, Markdown, plainText } from '../../lib/markdown.tsx';
import { addDaysTo, daysBetween, firstOccurrence, moveRule, repeatProblem, todayDate, withUntilFor } from '../../lib/repeat.ts';
import { useColors, type Colors } from '../../theme.ts';
import { ConfirmDialog } from '../controls/ConfirmDialog.tsx';
import { CheckIcon, DownloadIcon, FlagIcon, PlusIcon, RepeatIcon, TrashIcon } from '../controls/icons.tsx';
import type { MenuItem } from '../controls/Menu.tsx';
import {
  CalendarField,
  DateField,
  DEFAULT_TIME,
  DescriptionInput,
  Details,
  LabelsInput,
  LeaveDialog,
  LocationInput,
  MarkdownView,
  ModalShell,
  SidebarItem,
  UidLine,
  useLeavePrompt,
  useModalStyles,
  type Guard,
} from '../modalParts.tsx';
// No extension: the bundler picks LocationMap.native.tsx (a WebView) on Android/iOS.
import { LocationMap } from './LocationMap';
import { RepeatField } from './RepeatField.tsx';
import { dueColor, priorityColor, TaskCheckbox } from './TaskItem.tsx';
import { Button, SwitchRow } from '../controls/ui.tsx';

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
  /** `navigation` for /tasks/<uid>, `self` for a new task (see modalParts' Guard). */
  guard: Guard;
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
  /** Show a map under the location (a setting, off by default). */
  showMap?: boolean;
}

const PRIORITIES: Priority[] = [1, 2, 3, 4];

// Undocumented but keyless; the official Embed API would need every install to bring its own key.
// If Google ever drops it, the map breaks but the location's Google Maps button keeps working.
const embedUrl = (location: string) => `https://www.google.com/maps?q=${encodeURIComponent(location)}&output=embed`;
/** Waits for typing to pause before reloading the map. */
const MAP_DELAY_MS = 700;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

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
  showMap = false,
}: Props) {
  const colors = useColors();
  const shared = useModalStyles();
  const styles = makeStyles(colors);

  const isNew = task === undefined;
  const [calendar, setCalendar] = useState(initialCalendar);
  const [edits, setEdits] = useState(() => initialEdits(task));
  const [allDay, setAllDay] = useState(() => !task?.start?.time && !task?.due?.time);
  // The name and description show as formatted Markdown, and turn into their editor when tapped, like Todoist.
  // A new task starts with the name being typed.
  const [editing, setEditing] = useState<'summary' | 'description' | null>(isNew ? 'summary' : null);
  const mapLocation = useDebounced(edits.location.trim(), MAP_DELAY_MS);

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
  const leave = useLeavePrompt(guard, guarded, onClose);

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

  const openOther = onOpenTask && ((other: Task) => leave.leaveTo(() => onOpenTask(other)));

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
    leave.leaveNow();
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
        leave.leaveNow();
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

  const main = (
    <View style={shared.main}>
      <View style={styles.titleRow}>
        <View style={styles.titleCheck}>
          {task ? (
            <TaskCheckbox
              task={{ ...task, priority: edits.priority }}
              onToggle={(toggled) => {
                onToggle(toggled);
                leave.leaveNow();
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
        <View style={shared.editor}>
          {editing === 'summary' ? (
            <TextInput
              style={[shared.titleInput, shared.field, { borderColor: colors.textTertiary }]}
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
            <MarkdownView label="Task name" formatted={hasMarkdown(edits.summary)} onEdit={() => setEditing('summary')}>
              {edits.summary ? (
                <Text style={shared.titleText}>
                  <InlineMarkdown text={edits.summary} />
                </Text>
              ) : null}
            </MarkdownView>
          )}
          {editing === 'description' ? (
            <DescriptionInput
              value={edits.description}
              onChangeText={(description) => update({ description })}
              onBlur={() => setEditing(null)}
              placeholder="Description"
              label="Description"
            />
          ) : (
            <MarkdownView
              label="Description"
              formatted={hasMarkdown(edits.description, true)}
              onEdit={() => setEditing('description')}
              description
            >
              {edits.description.trim() ? <Markdown text={edits.description} style={shared.descriptionText} /> : null}
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
                <Text style={shared.muted}>
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
    <>
      <SidebarItem title="Project">
        <CalendarField
          label="Project"
          calendar={calendar}
          calendars={calendars}
          canPick={isNew && calendars.length > 1}
          onChange={setCalendar}
        />
      </SidebarItem>

      <SidebarItem
        title="Dates"
        action={
          <View style={shared.switches}>
            <SwitchRow label="All day" value={allDay} onChange={toggleAllDay} />
            <SwitchRow label="Start date" value={showStart} onChange={toggleStart} />
          </View>
        }
      >
        {showStart && (
          <DateField label="Start date" value={edits.start} allDay={allDay} onChange={(start) => changeDate('start', start)} />
        )}
        <DateField label="Due date" value={edits.due} allDay={allDay} colored onChange={(due) => changeDate('due', due)} />
        <RepeatField value={edits.recurrence} anchor={repeatAnchor} allDay={allDay} onChange={changeRepeat} />
        {edits.recurrence && !edits.start && !edits.due && (
          <View style={shared.inline}>
            <RepeatIcon color={colors.dueTomorrow} />
            <Text style={[shared.note, { color: colors.dueTomorrow }]}>Without a date, the repeat is removed too.</Text>
          </View>
        )}
      </SidebarItem>

      <SidebarItem title="Priority">
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

      <SidebarItem title="Labels">
        <LabelsInput initial={edits.categories} onChange={(categories) => update({ categories })} />
      </SidebarItem>

      <SidebarItem title="Location">
        <LocationInput value={edits.location} onChange={(location) => update({ location })} />
        {showMap && mapLocation !== '' && <LocationMap uri={embedUrl(mapLocation)} title={`Map of ${mapLocation}`} />}
      </SidebarItem>

      {task && (
        <Details
          rows={[
            ...(task.status ? [['Status', task.status.toLowerCase().replace('-', ' ')] as [string, string]] : []),
            ...(task.percentComplete !== undefined ? [['Progress', `${task.percentComplete}%`] as [string, string]] : []),
          ]}
          url={task.url}
          created={task.created}
          lastModified={task.lastModified}
        />
      )}

      {task && <UidLine uid={task.uid} />}
    </>
  );

  return (
    <ModalShell
      guard={guard}
      label={isNew ? 'Add task' : 'Task details'}
      calendar={calendar}
      crumb={
        parent &&
        openOther && (
          <>
            <Text style={shared.muted} aria-hidden>
              /
            </Text>
            <Pressable role="link" aria-label="Open the parent task" onPress={() => openOther(parent)} style={styles.crumbLink}>
              <Text style={styles.crumbText} numberOfLines={1}>
                {plainText(parent.summary) || 'Untitled task'}
              </Text>
            </Pressable>
          </>
        )
      }
      menuItems={menuItems}
      onRequestClose={leave.requestClose}
      main={main}
      sidebar={sidebar}
      message={dirty ? problem : null}
      saveLabel={isNew ? 'Add task' : 'Save'}
      canSave={canSave}
      onSave={save}
      keys={!leave.asking && !confirmingDelete}
    >
      {leave.asking && (
        <LeaveDialog
          kind="task"
          isNew={isNew}
          problem={dirty ? problem : null}
          unsavedNote={dirty ? undefined : 'The sub-task you typed has not been added.'}
          onSave={() => {
            if (dirty) onSave(finalEdits, calendar.href);
            if (subtaskDraft.trim()) addSubtask();
          }}
          onAnswer={leave.answer}
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
            leave.leaveNow();
            onDelete(task);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </ModalShell>
  );
}

type Styles = ReturnType<typeof makeStyles>;

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
  const dueTint = due && (task.completed ? colors.textTertiary : dueColor(colors, due.tone));
  return (
    <Pressable onPress={() => onOpen?.(task)} style={styles.subtask}>
      <TaskCheckbox task={task} onToggle={onToggle} />
      <Text style={[styles.subtaskTitle, task.completed && styles.struck]}>
        {task.summary ? <InlineMarkdown text={task.summary} /> : <Text style={{ color: colors.textTertiary }}>Untitled task</Text>}
      </Text>
      {due && dueTint && (
        <View style={styles.subtaskDue}>
          <Text style={{ fontSize: 12, color: dueTint }}>{due.label}</Text>
          {task.recurrence && <RepeatIcon color={dueTint} />}
        </View>
      )}
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    titleCheck: { marginTop: 6 },
    staticCheck: { width: 18, height: 18, borderRadius: 9, marginTop: 2 },
    crumbText: { fontSize: 13, color: colors.textSecondary, flexShrink: 1 },
    crumbLink: { flexShrink: 1, minWidth: 0, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
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
    subtaskDue: { flexDirection: 'row', alignItems: 'center', gap: 3 },
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
    priorities: { flexDirection: 'row', gap: 4 },
    priority: { width: 34, height: 34, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  });
