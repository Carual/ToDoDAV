import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import type { Task } from '../api/tasks.ts';
import { FilterIcon } from '../components/controls/icons.tsx';
import { IconButton } from '../components/controls/ui.tsx';
import { AddRow, EmptyState, ListPage, PageHeader, SectionToggle, useFoldSetting } from '../components/ListPage.tsx';
import { ShareModal } from '../components/ShareModal.tsx';
import { FilterModal } from '../components/tasks/FilterModal.tsx';
import { ImportExportModal } from '../components/tasks/ImportExportModal.tsx';
import { SettingsModal } from '../components/tasks/SettingsModal.tsx';
import { TaskItem } from '../components/tasks/TaskItem.tsx';
import { TaskModal } from '../components/tasks/TaskModal.tsx';
import { compareCompleted, hasShownChildren, openRows, subtaskCount, type Row } from '../lib/taskRows.ts';
import { DEFAULT_SETTINGS, describeFilters, filtersActive, type Filters } from '../lib/viewSettings.ts';
import { ALL } from '../state/calendarChoice.ts';
import { useLoggedIn } from '../state/session.tsx';
import { useTasks } from '../state/tasksContext.tsx';
import { useColors, type Colors } from '../theme.ts';

/** Below this width the layout is the phone one: narrower margins and indents. */
const NARROW = 640;

/** What the list shows, one entry per line. */
type Item =
  | { kind: 'open'; row: Row }
  | { kind: 'add' }
  | { kind: 'empty'; title: string; text: string }
  | { kind: 'completedHeader'; count: number }
  | { kind: 'completed'; task: Task };

export function Tasks() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const narrow = useWindowDimensions().width < NARROW;
  const tasks = useTasks();
  const { calendars, allView, calendar, settings, changeSettings, list, tree, view, calendarOf, toggleTask, openTask } = tasks;
  const { client, config, setCalendars } = useLoggedIn();
  const hasLists = calendars.length > 0;

  const [showCompleted, toggleShowCompleted] = useFoldSetting('tododav.showCompleted', false);
  /** UIDs of the tasks whose sub-tasks are hidden in the list. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
  const [editingFilters, setEditingFilters] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [transferring, setTransferring] = useState(false);

  function toggleCollapsed(uid: string) {
    const next = new Set(collapsed);
    if (!next.delete(uid)) next.add(uid);
    setCollapsed(next);
  }

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
        return <AddRow label="Add task" onPress={() => setCreating(true)} />;
      case 'empty':
        return <EmptyState title={item.title} text={item.text} />;
      case 'completedHeader':
        return <SectionToggle title="Completed" count={item.count} open={showCompleted} onToggle={toggleShowCompleted} />;
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
      <PageHeader
        allTitle="All"
        choice={tasks}
        selectLabel="Task list"
        actions={
          <IconButton label={filtered ? 'Filters (on)' : 'Filters'} active={filtered} onPress={() => setEditingFilters(true)}>
            <FilterIcon color={filtered ? colors.accent : colors.textSecondary} size={20} />
          </IconButton>
        }
        onShare={config.feed && (() => setSharing(true))}
        addLabel="Add task"
        onAdd={() => setCreating(true)}
      />
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

  return (
    <ListPage
      section="tasks"
      onSettings={() => setEditingSettings(true)}
      noCalendars={
        !hasLists && (
          <EmptyState
            title="No task lists found"
            text="Create a calendar with tasks (VTODO) on your CalDAV server, then log in again."
          />
        )
      }
      header={header}
      list={list}
      loadingLabel="Loading tasks"
      items={items}
      keyOf={(item) =>
        item.kind === 'open' ? item.row.task.href : item.kind === 'completed' ? `done ${item.task.href}` : item.kind
      }
      renderItem={renderItem}
      // A wider left edge keeps the sub-task chevron, which sits in the gutter, on screen.
      gutter={narrow ? { paddingLeft: 26, paddingRight: 16 } : { paddingHorizontal: 55 }}
      onQuickAdd={hasLists ? () => setCreating(true) : undefined}
    >
      {creating && tasks.newTaskCalendar && (
        <TaskModal
          guard="self"
          calendar={tasks.newTaskCalendar}
          calendars={calendars}
          onClose={() => setCreating(false)}
          onSave={tasks.createTask}
          onToggle={toggleTask}
          showMap={settings.showMap}
        />
      )}
      {sharing && calendar && config.feed && (
        <ShareModal client={client} calendar={calendar} token={config.feed.token} onClose={() => setSharing(false)} />
      )}
      {editingSettings && (
        <SettingsModal
          settings={settings}
          onChange={changeSettings}
          onImportExport={
            hasLists
              ? () => {
                  setEditingSettings(false);
                  setTransferring(true);
                }
              : undefined
          }
          onClose={() => setEditingSettings(false)}
        />
      )}
      {transferring && tasks.newTaskCalendar && (
        <ImportExportModal
          client={client}
          calendars={calendars}
          calendarHref={tasks.newTaskCalendar.href}
          compare={view.compare}
          onImported={(hrefs) => {
            for (const href of hrefs) list.refresh(href);
            // The "All" view already shows the lists imported into; several lists are best seen there too.
            if (!allView) tasks.selectCalendar(hrefs.length === 1 ? hrefs[0]! : ALL);
          }}
          onListsCreated={(created) => setCalendars([...calendars, ...created])}
          onClose={() => setTransferring(false)}
        />
      )}
      {editingFilters && (
        <FilterModal filters={filters} labels={labels} onChange={changeFilters} onClose={() => setEditingFilters(false)} />
      )}
    </ListPage>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    link: { color: colors.link, fontSize: 14 },
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
  });
