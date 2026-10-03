import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Calendar } from '../../api/caldav.ts';
import type { Task } from '../../api/tasks.ts';
import { describeDue, describeRepeat, type DueTone } from '../../lib/format.ts';
import { InlineMarkdown, previewLine } from '../../lib/markdown.tsx';
import { useColors, type Colors } from '../../theme.ts';
import { BLOCK_FIELDS, type RowField } from '../../lib/viewSettings.ts';
import { CalendarIcon, CheckIcon, ChevronDownIcon, HashIcon, MapPinIcon, RepeatIcon, SubtaskIcon, TagIcon } from '../controls/icons.tsx';

interface Props {
  task: Task;
  /** How far the task sits below other tasks (0: top level). */
  depth?: number;
  /** Space per level of depth: less on narrow screens. */
  indent: number;
  /** Direct sub-tasks: how many are done, out of how many. */
  subtasks?: { done: number; total: number };
  /** The details to show under the title, in order (from the settings). */
  fields: RowField[];
  /** The list the task is in, shown only where tasks of several lists mix (the "All" view). */
  project?: Calendar;
  /** Whether the open sub-tasks under this row are hidden; only for rows that have some. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onOpen?: (task: Task) => void;
  /** Completes an open task or reopens a completed one. */
  onToggle: (task: Task) => void;
}

/** Deeper sub-tasks stop moving right, so the list stays readable on narrow screens. */
const MAX_INDENT = 5;

/** Delay between ticking the circle and the task leaving the list, like Todoist. */
const COMPLETE_ANIMATION_MS = 300;

export const priorityColor = (colors: Colors, priority: Task['priority']) =>
  ({ 1: colors.p1, 2: colors.p2, 3: colors.p3, 4: colors.p4 })[priority];

export const dueColor = (colors: Colors, tone: DueTone) =>
  ({
    overdue: colors.dueOverdue,
    today: colors.dueToday,
    tomorrow: colors.dueTomorrow,
    week: colors.dueWeek,
    later: colors.dueLater,
  })[tone];

/** Round checkbox colored by priority; fills when completed. */
export function TaskCheckbox({ task, onToggle }: { task: Task; onToggle: (task: Task) => void }) {
  const colors = useColors();
  const [checked, setChecked] = useState(task.completed);
  // A repeating task comes back open on its next date (and a failed save flips a task back): drop the tick.
  useEffect(() => setChecked(task.completed), [task.completed, task.ics]);
  const color = priorityColor(colors, task.priority);
  const strong = task.priority !== 4;
  return (
    <Pressable
      role="checkbox"
      aria-checked={checked}
      aria-label={task.completed ? 'Reopen task' : 'Complete task'}
      hitSlop={10}
      onPress={() => {
        if (checked !== task.completed) return; // already on its way out
        setChecked(!checked);
        setTimeout(() => onToggle(task), COMPLETE_ANIMATION_MS);
      }}
    >
      {({ pressed, hovered }) => (
        <View
          style={[
            styles.check,
            {
              borderColor: color,
              borderWidth: strong ? 2 : 1,
              // 8-digit hex: the priority color at 10%, as color-mix() tints it in frontend-react.
              backgroundColor: checked ? color : strong ? `${color}1a` : 'transparent',
            },
          ]}
        >
          {(checked || pressed || hovered) && <CheckIcon color={checked ? '#fff' : color} size={12} />}
        </View>
      )}
    </Pressable>
  );
}

/** The repeat icon after a date, with the rule in words for screen readers. */
function RepeatMark({ task, color }: { task: Task; color: string }) {
  if (!task.recurrence) return null;
  return (
    <View aria-label={describeRepeat(task.recurrence, task.start ?? task.due)} style={styles.repeat}>
      <RepeatIcon color={color} />
    </View>
  );
}

/** One detail of a row, or nothing when the task has no such detail. */
function renderField(field: RowField, task: Task, subtasks: Props['subtasks'], colors: Colors): ReactNode {
  const muted = colors.textTertiary;
  switch (field) {
    case 'description': {
      const firstLine = previewLine(task.description);
      return (
        firstLine && (
          <Text style={[styles.small, { color: muted }]} numberOfLines={1}>
            <InlineMarkdown text={firstLine} />
          </Text>
        )
      );
    }
    case 'location':
      return (
        task.location && (
          <View style={styles.item}>
            <MapPinIcon color={muted} size={12} />
            <Text style={[styles.small, styles.shrink, { color: muted }]} numberOfLines={1}>
              {task.location}
            </Text>
          </View>
        )
      );
    case 'subtasks':
      return (
        subtasks !== undefined &&
        subtasks.total > 0 && (
          <View style={styles.item} aria-label={`${subtasks.done} of ${subtasks.total} sub-tasks done`}>
            <SubtaskIcon color={muted} />
            <Text style={[styles.small, { color: muted }]}>
              {subtasks.done}/{subtasks.total}
            </Text>
          </View>
        )
      );
    case 'start':
      return (
        task.start && (
          <View style={styles.item}>
            <CalendarIcon color={muted} />
            <Text style={[styles.small, { color: muted }]}>Starts {describeDue(task.start).label}</Text>
            {/* A repeat usually sits on the due date; with none, the start date carries it. */}
            {!task.due && <RepeatMark task={task} color={muted} />}
          </View>
        )
      );
    case 'due': {
      if (!task.due) return null;
      const due = describeDue(task.due);
      const color = task.completed ? muted : dueColor(colors, due.tone);
      return (
        <View style={styles.item}>
          <CalendarIcon color={color} />
          <Text style={[styles.small, { color }]}>{due.label}</Text>
          <RepeatMark task={task} color={color} />
        </View>
      );
    }
    case 'labels':
      return task.categories.map((label) => (
        <View key={label} style={styles.item}>
          <TagIcon color={muted} />
          <Text style={[styles.small, { color: muted }]}>{label}</Text>
        </View>
      ));
  }
}

/** The details in the chosen order; small ones next to each other share a line. */
function TaskDetails({ task, fields, subtasks }: { task: Task; fields: RowField[]; subtasks: Props['subtasks'] }) {
  const colors = useColors();
  const lines: ReactNode[] = [];
  let inline: ReactNode[] = [];
  const flush = () => {
    if (inline.length > 0) {
      lines.push(
        <View key={lines.length} style={styles.meta}>
          {inline}
        </View>,
      );
    }
    inline = [];
  };
  for (const field of fields) {
    const content = renderField(field, task, subtasks, colors);
    const empty = !content || (Array.isArray(content) && content.length === 0);
    if (empty) continue;
    if (BLOCK_FIELDS.has(field)) {
      flush();
      lines.push(
        <View key={lines.length} style={styles.block}>
          {content}
        </View>,
      );
    } else {
      inline.push(<View key={field}>{content}</View>);
    }
  }
  flush();
  return <>{lines}</>;
}

export function TaskItem({ task, depth = 0, indent, subtasks, fields, project, collapsed, onToggleCollapsed, onOpen, onToggle }: Props) {
  const colors = useColors();
  const rowStyle = [styles.task, { marginLeft: Math.min(depth, MAX_INDENT) * indent, borderBottomColor: colors.divider }];
  const content = (
    <>
      {onToggleCollapsed && (
        // In the gutter left of the row, like Todoist; always shown, since touch screens have no hover.
        <Pressable
          style={styles.collapse}
          role="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Show sub-tasks' : 'Hide sub-tasks'}
          hitSlop={8}
          onPress={onToggleCollapsed}
        >
          <View style={collapsed && styles.rotated}>
            <ChevronDownIcon color={colors.textTertiary} />
          </View>
        </Pressable>
      )}
      <TaskCheckbox task={task} onToggle={onToggle} />
      <View style={styles.body}>
        <Text
          style={[
            styles.title,
            { color: task.completed ? colors.textTertiary : colors.text },
            task.completed && styles.struck,
          ]}
        >
          {task.summary ? <InlineMarkdown text={task.summary} /> : <Text style={{ color: colors.textTertiary }}>Untitled task</Text>}
        </Text>
        <TaskDetails task={task} fields={fields} subtasks={subtasks} />
      </View>
      {project && (
        <View style={styles.project} aria-label={`In ${project.name}`}>
          <Text style={[styles.small, styles.shrink, { color: colors.textTertiary }]} numberOfLines={1}>
            {project.name}
          </Text>
          <HashIcon color={project.color ?? colors.textTertiary} size={12} />
        </View>
      )}
    </>
  );
  // A row that opens nothing is a plain view: a disabled Pressable would also disable the checkbox inside it
  // for assistive technologies.
  if (!onOpen) return <View style={rowStyle}>{content}</View>;
  return (
    <Pressable
      onPress={() => onOpen(task)}
      style={({ pressed, hovered }) => [rowStyle, (pressed || hovered) && { backgroundColor: colors.bgSoft }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  task: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  collapse: {
    position: 'absolute',
    top: 9,
    left: -24,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
  rotated: { transform: [{ rotate: '-90deg' }] },
  check: {
    width: 18,
    height: 18,
    marginTop: 2,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, paddingLeft: 4 },
  title: { fontSize: 14, lineHeight: 21 },
  struck: { textDecorationLine: 'line-through' },
  small: { fontSize: 12, lineHeight: 18 },
  shrink: { flexShrink: 1 },
  block: { marginTop: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 4, marginTop: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  repeat: { marginLeft: 2 },
  project: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: '35%' },
});
