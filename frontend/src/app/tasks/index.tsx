import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Task } from '../../api/tasks.ts';
import { ChevronDownIcon, FilterIcon, HashIcon, LayersIcon, PlusIcon } from '../../components/controls/icons.tsx';
import { Select } from '../../components/controls/Select.tsx';
import { FilterModal } from '../../components/tasks/FilterModal.tsx';
import { SettingsModal } from '../../components/tasks/SettingsModal.tsx';
import { TaskItem } from '../../components/tasks/TaskItem.tsx';
import { TaskModal } from '../../components/tasks/TaskModal.tsx';
import { TopBar } from '../../components/TopBar.tsx';
import { IconButton } from '../../components/controls/ui.tsx';
import { compareCompleted, hasShownChildren, openRows, subtaskCount, type Row } from '../../lib/taskRows.ts';
import { ALL, useTasks } from '../../state/tasksContext.tsx';
import { useColors, type Colors } from '../../theme.ts';
import {
  DEFAULT_SETTINGS,
  describeFilters,
  filtersActive,
  readSetting,
  saveSetting,
  type Filters,
} from '../../lib/viewSettings.ts';

const SHOW_COMPLETED_KEY = 'tododav.showCompleted';
/** Below this width the layout is the phone one: narrower margins and indents. */
const NARROW = 640;

/** What the list shows, one entry per line. */
type Item =
  | { kind: 'open'; row: Row }
  | { kind: 'add' }
  | { kind: 'empty'; title: string; text: string }
  | { kind: 'completedHeader'; count: number }
  | { kind: 'completed'; task: Task };

export default function TasksScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { width } = useWindowDimensions();
  const narrow = width < NARROW;
  const {
    calendars,
    selected,
    allView,
    calendar,
    canShowAll,
    selectCalendar,
    settings,
    changeSettings,
    list,
    tree,
    view,
    calendarOf,
    toggleTask,
    createTask,
    newTaskCalendar,
    openTask,
  } = useTasks();
  const hasLists = calendars.length > 0;

  const [showCompleted, setShowCompleted] = useState(() => readSetting(SHOW_COMPLETED_KEY) === 'true');
  /** UIDs of the tasks whose sub-tasks are hidden in the list. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
  const [editingFilters, setEditingFilters] = useState(false);

  function toggleCollapsed(uid: string) {
    const next = new Set(collapsed);
    if (!next.delete(uid)) next.add(uid);
    setCollapsed(next);
  }

  function toggleShowCompleted() {
    setShowCompleted(!showCompleted);
    saveSetting(SHOW_COMPLETED_KEY, String(!showCompleted));
  }

  async function refresh() {
    setRefreshing(true);
    await list.reload();
    setRefreshing(false);
  }

  // "Q" opens the new-task modal on the web, like Todoist's quick add (not while typing or with a modal open).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key.toLowerCase() !== 'q' || event.ctrlKey || event.metaKey || event.altKey || typing) return;
      // A dialog of any kind (the task page, a picker) sits on top: leave the key to it.
      if (creating || !hasLists || document.querySelector('[aria-modal="true"], [role="dialog"]')) return;
      event.preventDefault();
      setCreating(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [creating, hasLists]);

  const { filters } = settings;
  const filtered = filtersActive(filters);
  const fields = settings.fields.filter((f) => f.visible).map((f) => f.field);
  const changeFilters = (next: Filters) => changeSettings({ ...settings, filters: next });
  const labels = useMemo(
    () => [...new Set(list.tasks.flatMap((t) => t.categories))].sort((a, b) => a.localeCompare(b)),
    [list.tasks],
  );

  const openTasks = openRows(list.tasks, tree, collapsed, view);
  const completedTasks = list.tasks.filter((t) => t.completed && view.matches(t)).sort(compareCompleted);
  const where = allView ? 'in any list' : 'in this list';

  const items: Item[] = [
    ...openTasks.map((row): Item => ({ kind: 'open', row })),
    { kind: 'add' },
    ...(openTasks.length > 0
      ? []
      : [
          filtered
            ? { kind: 'empty' as const, title: 'No matching tasks', text: `No open tasks ${where} match the filters.` }
            : { kind: 'empty' as const, title: 'All clear', text: `No open tasks ${where}.` },
        ]),
    ...(completedTasks.length > 0 ? [{ kind: 'completedHeader' as const, count: completedTasks.length }] : []),
    ...(showCompleted ? completedTasks.map((task): Item => ({ kind: 'completed', task })) : []),
  ];

  const indent = narrow ? 20 : 28;
  // A wider left edge keeps the sub-task chevron, which sits in the gutter, on screen.
  const gutter = narrow ? { paddingLeft: 26, paddingRight: 16 } : { paddingHorizontal: 55 };

  function renderItem({ item }: { item: Item }) {
    switch (item.kind) {
      case 'open': {
        const { task, depth } = item.row;
        return (
          <TaskItem
            task={task}
            depth={depth}
            indent={indent}
            subtasks={subtaskCount(tree, task)}
            fields={fields}
            project={allView ? calendarOf(task) : undefined}
            collapsed={collapsed.has(task.uid)}
            onToggleCollapsed={hasShownChildren(tree, task, view) ? () => toggleCollapsed(task.uid) : undefined}
            onOpen={openTask}
            onToggle={toggleTask}
          />
        );
      }
      case 'add':
        return (
          <Pressable role="button" onPress={() => setCreating(true)} style={styles.addTask}>
            {({ pressed, hovered }) => (
              <>
                <View style={[styles.addIcon, (pressed || hovered) && { backgroundColor: colors.accent }]}>
                  <PlusIcon color={pressed || hovered ? '#fff' : colors.accent} />
                </View>
                <Text style={[styles.addText, (pressed || hovered) && { color: colors.accent }]}>Add task</Text>
              </>
            )}
          </Pressable>
        );
      case 'empty':
        return (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{item.title}</Text>
            <Text style={styles.emptyText}>{item.text}</Text>
          </View>
        );
      case 'completedHeader':
        return (
          <Pressable role="button" aria-expanded={showCompleted} onPress={toggleShowCompleted} style={styles.completedToggle}>
            <View style={!showCompleted && styles.rotated}>
              <ChevronDownIcon color={colors.textTertiary} />
            </View>
            <Text style={styles.completedTitle}>Completed</Text>
            <Text style={styles.completedCount}>{item.count}</Text>
          </Pressable>
        );
      case 'completed':
        return (
          <TaskItem
            task={item.task}
            indent={indent}
            fields={fields}
            project={allView ? calendarOf(item.task) : undefined}
            onOpen={openTask}
            onToggle={toggleTask}
          />
        );
    }
  }

  const header = (
    <>
      <View style={styles.viewHeader}>
        <Text style={styles.viewTitle} role="heading">
          {calendar?.name ?? 'All'}
        </Text>
        <View style={styles.viewActions}>
          <IconButton label={filtered ? 'Filters (on)' : 'Filters'} active={filtered} onPress={() => setEditingFilters(true)}>
            <FilterIcon color={filtered ? colors.accent : colors.textSecondary} size={20} />
          </IconButton>
          {canShowAll && (
            <Select
              quiet
              aria-label="Task list"
              value={selected ?? ALL}
              onChange={selectCalendar}
              style={styles.calendarSelect}
              options={[
                { value: ALL, label: 'All', icon: <LayersIcon color={colors.textSecondary} /> },
                ...calendars.map((c) => ({
                  value: c.href,
                  label: c.name,
                  icon: <HashIcon color={c.color ?? colors.textSecondary} />,
                })),
              ]}
            />
          )}
          {/* The same as "+ Add task" under the list, reachable without scrolling past a long one. */}
          <IconButton label="Add task" filled size={30} onPress={() => setCreating(true)}>
            <PlusIcon color={colors.accentText} size={16} />
          </IconButton>
        </View>
      </View>
      {filtered && (
        <View style={styles.filterBar}>
          <Pressable role="button" onPress={() => setEditingFilters(true)} style={styles.filterSummary}>
            <Text style={styles.filterSummaryText}>Filtered: {describeFilters(filters).join(' · ')}</Text>
          </Pressable>
          <Pressable role="button" hitSlop={8} onPress={() => changeFilters(DEFAULT_SETTINGS.filters)}>
            <Text style={styles.link}>Clear</Text>
          </Pressable>
        </View>
      )}
    </>
  );

  let content;
  if (!hasLists) {
    content = (
      <View style={[styles.empty, gutter]}>
        <Text style={styles.emptyTitle}>No task lists found</Text>
        <Text style={styles.emptyText}>Create a calendar with tasks (VTODO) on your CalDAV server, then log in again.</Text>
      </View>
    );
  } else if (list.loadError && !list.loaded) {
    content = (
      <View style={[styles.column, gutter]}>
        {header}
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.p1 }]}>{list.loadError}</Text>
          <Pressable role="button" onPress={() => void list.reload()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  } else if (!list.loaded) {
    content = (
      <View style={[styles.column, gutter]}>
        {header}
        <ActivityIndicator style={styles.loading} color={colors.textTertiary} aria-label="Loading tasks" />
      </View>
    );
  } else {
    content = (
      <FlatList
        data={items}
        keyExtractor={(item) =>
          item.kind === 'open' ? item.row.task.href : item.kind === 'completed' ? `done ${item.task.href}` : item.kind
        }
        renderItem={renderItem}
        ListHeaderComponent={header}
        contentContainerStyle={[styles.column, gutter, styles.listEnd]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.accent]} />}
      />
    );
  }

  return (
    <SafeAreaView style={styles.page} edges={['left', 'right']}>
      <TopBar section="tasks" onSettings={() => setEditingSettings(true)} />
      {content}

      {creating && newTaskCalendar && (
        <TaskModal
          guard="self"
          calendar={newTaskCalendar}
          calendars={calendars}
          onClose={() => setCreating(false)}
          onSave={createTask}
          onToggle={toggleTask}
        />
      )}
      {editingSettings && (
        <SettingsModal settings={settings} onChange={changeSettings} onClose={() => setEditingSettings(false)} />
      )}
      {editingFilters && (
        <FilterModal filters={filters} labels={labels} onChange={changeFilters} onClose={() => setEditingFilters(false)} />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    link: { color: colors.link, fontSize: 14 },
    column: { width: '100%', maxWidth: 800, alignSelf: 'center', paddingTop: 24 },
    listEnd: { paddingBottom: 96 },
    viewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 16,
    },
    viewTitle: { flexShrink: 1, fontSize: 26, lineHeight: 35, fontWeight: '700', color: colors.text },
    viewActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
    calendarSelect: { maxWidth: 220 },
    filterBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
      paddingVertical: 4,
      paddingLeft: 10,
      paddingRight: 8,
      borderRadius: 5,
      backgroundColor: colors.bgSoft,
    },
    filterSummary: { flex: 1 },
    filterSummaryText: { fontSize: 13, color: colors.textSecondary },
    loading: { paddingVertical: 48 },
    addTask: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    addIcon: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    addText: { fontSize: 14, lineHeight: 21, color: colors.textTertiary },
    empty: { alignItems: 'center', paddingVertical: 64 },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
    emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
    secondaryButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    secondaryButtonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    completedToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 24,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    rotated: { transform: [{ rotate: '-90deg' }] },
    completedTitle: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: colors.text },
    completedCount: { fontSize: 14, color: colors.textTertiary },
  });
