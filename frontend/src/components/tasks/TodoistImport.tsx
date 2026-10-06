import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Calendar, CalDavClient } from '../../api/caldav.ts';
import { storeTasks, type ImportResult, type ImportTarget } from '../../api/importTasks.ts';
import {
  addNotes,
  completedSince,
  convertAccount,
  fetchAccount,
  fetchCompleted,
  isTokenShaped,
  noNotes,
  TOKEN_PAGE,
  type CompletedTask,
  type ConversionNotes,
  type TodoistAccount,
  type TodoistProject,
} from '../../api/todoistApi.ts';
import { useColors, fs, type Colors } from '../../theme.ts';
import { HashIcon, PlusIcon } from '../controls/icons.tsx';
import { Select, type SelectOption } from '../controls/Select.tsx';
import { Section, SettingRow } from '../controls/SmallDialog.tsx';
import { Button } from '../controls/ui.tsx';
import {
  Actions,
  BusyButton,
  Failures,
  Message,
  messageOf,
  plural,
  Progress,
  ProgressText,
  Strong,
  TextLink,
  Warnings,
} from './transferParts.tsx';

type Range = 'none' | 'month' | 'quarter' | 'year' | 'all';

const RANGES: SelectOption<Range>[] = [
  { value: 'none', label: 'None' },
  { value: 'month', label: 'Last month' },
  { value: 'quarter', label: 'Last 3 months' },
  { value: 'year', label: 'Last year' },
  { value: 'all', label: 'All history' },
];

// Where a project goes: nowhere, a new list, or an existing list's href (which starts with / or http, so never
// one of these).
const SKIP = 'skip';
const NEW = 'new';

/** The completed tasks loaded so far, from `since` to when the loading started. */
interface History {
  since: Date;
  tasks: CompletedTask[];
}

type Run =
  | { step: 'lists' | 'tasks'; done: number; total: number }
  | { step: 'done'; result: ImportResult; lists: number; listFailures: string[]; warnings: string[] }
  | { step: 'error'; message: string };

interface Props {
  client: CalDavClient;
  calendars: Calendar[];
  /** The list on screen, where the Inbox goes unless the user picks another. */
  calendarHref: string;
  /** True while tasks are being written, when the dialog must not close. */
  onBusyChange: (busy: boolean) => void;
  onImported: (calendarHrefs: string[]) => void;
  onListsCreated: (created: Calendar[]) => void;
}

function sinceOf(range: Exclude<Range, 'none'>, joinedAt: Date, now = new Date()): Date {
  if (range === 'all') return joinedAt;
  const since = new Date(now);
  if (range === 'month') since.setMonth(since.getMonth() - 1);
  else if (range === 'quarter') since.setMonth(since.getMonth() - 3);
  else since.setFullYear(since.getFullYear() - 1);
  return since;
}

function warningsOf(notes: ConversionNotes): string[] {
  const warnings: string[] = [];
  if (notes.unreadRepeats > 0) {
    warnings.push(
      `${plural(notes.unreadRepeats, 'repeat')} could not be read, so ${notes.unreadRepeats === 1 ? 'it went' : 'they went'} into the description; the next date was kept.`,
    );
  }
  if (notes.fromCompletion > 0) {
    warnings.push(
      `${plural(notes.fromCompletion, 'task')} repeated from the completion date in Todoist (every!); here ${notes.fromCompletion === 1 ? 'it repeats' : 'they repeat'} on fixed dates.`,
    );
  }
  if (notes.deadlinesKept > 0) {
    warnings.push(`${plural(notes.deadlinesKept, 'task')} had both a date and a deadline; the deadline was added to the description.`);
  }
  if (notes.sectioned > 0) warnings.push('Tasks in a Todoist section got the section name as a label.');
  return warnings;
}

const openTokenPage = () => void Linking.openURL(TOKEN_PAGE).catch(() => {});

/**
 * Imports a whole Todoist account through its API. The token is used from this device only (never sent to the
 * ToDoDAV server, never stored) and is forgotten after the import, or when this component goes away.
 */
export function TodoistImport({ client, calendars, calendarHref, onBusyChange, onImported, onListsCreated }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<TodoistAccount | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [range, setRange] = useState<Range>('none');
  const [history, setHistory] = useState<History | null>(null);
  /** The same history, readable at once by a load that is running. */
  const historyRef = useRef<History | null>(null);
  /** Completed tasks found so far while the history loads; null when it isn't loading. */
  const [loading, setLoading] = useState<number | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const importing = run?.step === 'lists' || run?.step === 'tasks';

  useEffect(() => onBusyChange(importing), [importing, onBusyChange]);
  // Closing the dialog (or picking another format) stops a history that is still loading.
  useEffect(() => () => abortRef.current?.abort(), []);

  const since = account && range !== 'none' ? sinceOf(range, account.joinedAt) : null;
  const completed = useMemo(
    () => (account && history && range !== 'none' ? completedSince(account, history.tasks, sinceOf(range, account.joinedAt)) : []),
    [account, history, range],
  );

  const counts = useMemo(() => {
    const result = new Map<string, { open: number; completed: number }>();
    const of = (id: string) => result.get(id) ?? result.set(id, { open: 0, completed: 0 }).get(id)!;
    for (const task of account?.tasks ?? []) of(task.project_id).open++;
    for (const task of completed) of(task.project_id).completed++;
    return result;
  }, [account, completed]);

  async function connect() {
    const trimmed = token.trim();
    if (!trimmed || connecting) return;
    if (!isTokenShaped(trimmed)) {
      setError("That doesn't look like a Todoist API token.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const next = await fetchAccount(trimmed);
      setToken(trimmed);
      setAccount(next);
      // A safe start: the Inbox goes to the list on screen and nothing else moves until the user says so.
      setTargets(Object.fromEntries(next.projects.map((p) => [p.id, p.inbox ? calendarHref : SKIP])));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setConnecting(false);
    }
  }

  function reset() {
    abortRef.current?.abort();
    historyRef.current = null;
    setToken('');
    setAccount(null);
    setHistory(null);
    setRange('none');
    setLoading(null);
    setHistoryError(null);
    setRun(null);
    setError(null);
  }

  /**
   * Loads what the history lacks for this range. The history grows backwards from now, so a longer range only
   * fetches the part before what is already loaded, and a stopped load can be resumed by choosing it again.
   */
  async function chooseRange(next: Range) {
    abortRef.current?.abort();
    setRange(next);
    setHistoryError(null);
    if (next === 'none' || !account) return;
    const wanted = sinceOf(next, account.joinedAt);
    const have = historyRef.current;
    if (have && have.since <= wanted) return;

    const controller = new AbortController();
    abortRef.current = controller;
    const before = have?.tasks.length ?? 0;
    setLoading(before);
    try {
      await fetchCompleted(token, wanted, have?.since ?? new Date(), {
        signal: controller.signal,
        onCount: (count) => setLoading(before + count),
        onStep: (tasks, reached) => {
          const grown = { since: reached, tasks: [...(historyRef.current?.tasks ?? []), ...tasks] };
          historyRef.current = grown;
          setHistory(grown);
        },
      });
    } catch (err) {
      if (!controller.signal.aborted) setHistoryError(messageOf(err));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(null);
      }
    }
  }

  function stopLoading() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(null);
  }

  const chosen = account?.projects.filter((p) => (targets[p.id] ?? SKIP) !== SKIP) ?? [];
  const openCount = chosen.reduce((sum, p) => sum + (counts.get(p.id)?.open ?? 0), 0);
  const completedCount = chosen.reduce((sum, p) => sum + (counts.get(p.id)?.completed ?? 0), 0);
  const newLists = chosen.filter((p) => targets[p.id] === NEW).length;
  const listCount = new Set(chosen.filter((p) => targets[p.id] !== NEW).map((p) => targets[p.id])).size + newLists;
  const total = openCount + completedCount;
  // A stopped (or failed) load leaves the history shorter than the range asked for.
  const historyShort = loading === null && since !== null && (!history || history.since > since);

  async function runImport() {
    if (!account) return;
    const listFailures: string[] = [];
    const where = new Map<string, { href: string; isNew: boolean }>();
    const toCreate = chosen.filter((p) => targets[p.id] === NEW);
    setRun({ step: 'lists', done: 0, total: toCreate.length });

    const created: Calendar[] = [];
    for (const [index, project] of toCreate.entries()) {
      try {
        const calendar = await client.createCalendar(project.shortName, project.color);
        created.push(calendar);
        where.set(project.id, { href: calendar.href, isNew: true });
      } catch (err) {
        listFailures.push(`${project.name}: the list could not be created (${messageOf(err)})`);
      }
      setRun({ step: 'lists', done: index + 1, total: toCreate.length });
    }
    if (created.length > 0) {
      onListsCreated(created);
      // Should the import fail and be tried again, these projects go to the lists just made, not to new ones.
      setTargets((current) => ({ ...current, ...Object.fromEntries([...where].map(([id, target]) => [id, target.href])) }));
    }
    for (const project of chosen) {
      if (targets[project.id] !== NEW) where.set(project.id, { href: targets[project.id]!, isNew: false });
    }

    setRun({ step: 'tasks', done: 0, total });
    // Let the progress show: converting a big account takes a moment.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const byProject = convertAccount(account, completed);
    const byList = new Map<string, ImportTarget>();
    let notes = noNotes();
    for (const project of chosen) {
      const target = where.get(project.id);
      const items = byProject.get(project.id);
      if (!target || !items) continue;
      const all = [...items.open, ...items.completed];
      for (const item of all) notes = addNotes(notes, item.notes);
      const list = byList.get(target.href) ?? byList.set(target.href, { href: target.href, items: [], isNew: target.isNew }).get(target.href)!;
      list.items.push(...all);
    }

    try {
      const result = await storeTasks(client, [...byList.values()], (done, count) => setRun({ step: 'tasks', done, total: count }));
      if (result.changed.length > 0) onImported(result.changed);
      // Everything has been fetched: the token is no longer needed.
      setToken('');
      setRun({ step: 'done', result, lists: byList.size, listFailures, warnings: warningsOf(notes) });
    } catch (err) {
      setRun({ step: 'error', message: messageOf(err) });
    }
  }

  if (!account) {
    return (
      <Section title="Import from Todoist">
        <Message>
          Copies your Todoist projects into task lists here: sub-tasks at any depth, exact dates, repeats, labels, comments
          and, if you want, completed tasks. Importing again adds only what is new.
        </Message>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>API token</Text>
          <TextInput
            value={token}
            onChangeText={setToken}
            editable={!connecting}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            aria-label="API token"
            returnKeyType="go"
            onSubmitEditing={() => void connect()}
            style={styles.input}
          />
        </View>
        <Message tone="muted">
          Find it in Todoist under <TextLink label="Settings → Integrations → Developer" onPress={openTokenPage} />. It goes
          from this device straight to Todoist, never to this server, and is forgotten after the import. It gives full
          access to your Todoist account, so you may want to make a new one there afterwards.
        </Message>
        {error && <Message tone="error">{error}</Message>}
        <Actions>
          <BusyButton
            label="Connect"
            busyLabel="Connecting"
            busy={connecting}
            disabled={!token.trim()}
            primary
            onPress={() => void connect()}
          />
        </Actions>
      </Section>
    );
  }

  if (run?.step === 'lists' || run?.step === 'tasks') {
    return (
      <Section title="Import from Todoist">
        <Progress label="Importing">
          <ProgressText>
            {run.step === 'lists'
              ? `Creating lists: ${run.done} of ${run.total}...`
              : `Importing ${run.done.toLocaleString()} of ${plural(run.total, 'task')}...`}
          </ProgressText>
        </Progress>
      </Section>
    );
  }

  if (run?.step === 'done') {
    const { result, lists, listFailures, warnings } = run;
    return (
      <Section title="Import from Todoist">
        <Message tone="status">
          Imported {plural(result.imported, 'task')} into {plural(lists, 'list')}.
          {result.skipped > 0 && ` ${plural(result.skipped, 'task')} ${result.skipped === 1 ? 'was' : 'were'} already there.`}
        </Message>
        <Warnings warnings={warnings} />
        <Failures title="Not everything could be saved:" failures={[...listFailures, ...result.failures]} />
        <Message tone="muted">
          The token has been forgotten. To be sure nobody else can use it, make a new one in{' '}
          <TextLink label="Todoist's settings" onPress={openTokenPage} />.
        </Message>
        <Actions>
          <Button label="Import again" onPress={reset} />
        </Actions>
      </Section>
    );
  }

  const projectOptions = (project: TodoistProject): SelectOption<string>[] => [
    { value: SKIP, label: "Don't import" },
    { value: NEW, label: `New list "${project.shortName}"`, icon: <PlusIcon color={colors.textSecondary} /> },
    ...calendars.map((c) => ({
      value: c.href,
      label: c.name,
      icon: <HashIcon color={c.color ?? colors.textSecondary} />,
    })),
  ];
  const setAll = (target: (project: TodoistProject) => string) =>
    setTargets(Object.fromEntries(account.projects.map((p) => [p.id, target(p)])));
  const screenList = calendars.find((c) => c.href === calendarHref);

  return (
    <>
      <Section title="Projects">
        <Message>Choose where each Todoist project goes. Sub-tasks stay with their project.</Message>
        <Actions>
          <Button label="Each into a new list" onPress={() => setAll(() => NEW)} />
          {screenList && <Button label={`All into ${screenList.name}`} onPress={() => setAll(() => screenList.href)} />}
          <Button label="None" onPress={() => setAll(() => SKIP)} />
        </Actions>
        <View style={styles.projects}>
          {account.projects.map((project) => {
            const count = counts.get(project.id) ?? { open: 0, completed: 0 };
            return (
              <View style={styles.project} key={project.id}>
                <View style={styles.projectName}>
                  <Text style={styles.name} numberOfLines={1}>
                    {project.name}
                  </Text>
                  <Text style={styles.count}>
                    {plural(count.open, 'open task')}
                    {count.completed > 0 && `, ${count.completed.toLocaleString()} completed`}
                  </Text>
                </View>
                <Select
                  aria-label={`Where ${project.name} goes`}
                  value={targets[project.id] ?? SKIP}
                  onChange={(value) => setTargets({ ...targets, [project.id]: value })}
                  options={projectOptions(project)}
                />
              </View>
            );
          })}
        </View>
      </Section>

      <Section title="Completed tasks">
        <SettingRow label="Include">
          <Select aria-label="Completed tasks to include" value={range} onChange={(value) => void chooseRange(value)} options={RANGES} />
        </SettingRow>
        <Message tone="muted">
          A task that repeats is imported once, open, with its next date. A whole history can take a while: it is loaded a
          few months at a time, and you can stop and import what has been found.
        </Message>
        {loading !== null && (
          <Progress label="Loading completed tasks">
            <ProgressText>Found {plural(loading, 'completed task')}...</ProgressText>
            <Button label="Stop" onPress={stopLoading} />
          </Progress>
        )}
        {historyError && (
          <Message tone="error">
            {historyError} <TextLink label="Try again" onPress={() => void chooseRange(range)} />
          </Message>
        )}
        {historyShort && !historyError && (
          <Message tone="muted">
            {history
              ? `Only tasks completed since ${history.since.toLocaleDateString()} are included. `
              : 'No completed tasks have been loaded. '}
            <TextLink label={history ? 'Load the rest' : 'Load them'} onPress={() => void chooseRange(range)} />
          </Message>
        )}
      </Section>

      <Section>
        {run?.step === 'error' && <Message tone="error">{run.message}</Message>}
        <Message>
          {total === 0 ? (
            'Choose at least one project with tasks.'
          ) : (
            <>
              <Strong>{plural(total, 'task')}</Strong>
              {completedCount > 0 && ` (${openCount.toLocaleString()} open, ${completedCount.toLocaleString()} completed)`} into{' '}
              {plural(listCount, 'list')}
              {newLists > 0 && `, ${newLists} of them new`}.
            </>
          )}
        </Message>
        <Actions>
          <Button
            label={`Import ${plural(total, 'task')}`}
            variant="primary"
            disabled={total === 0 || loading !== null}
            onPress={() => void runImport()}
          />
          <Button label="Use another token" onPress={reset} />
        </Actions>
      </Section>
    </>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    field: { gap: 6 },
    fieldLabel: { fontSize: fs(13), fontWeight: '600', color: colors.text },
    input: {
      minHeight: 36,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderRadius: 6,
      borderColor: colors.border,
      backgroundColor: colors.bg,
      color: colors.text,
      fontSize: fs(14),
    },
    projects: { gap: 8 },
    project: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    projectName: { flexShrink: 1, minWidth: 120 },
    name: { fontSize: fs(13), color: colors.text },
    count: { fontSize: fs(12), color: colors.textTertiary },
  });
