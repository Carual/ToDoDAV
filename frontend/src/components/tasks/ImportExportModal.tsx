import { useState } from 'react';

import type { Calendar, CalDavClient } from '../../api/caldav.ts';
import { icsToTasks, tasksToIcs, type ImportItem, type ParsedImport } from '../../api/icsFile.ts';
import { storeTasks } from '../../api/importTasks.ts';
import type { Task } from '../../api/tasks.ts';
import { tasksToTodoist, todoistToTasks } from '../../api/todoist.ts';
import { download } from '../../lib/download';
import { fileName } from '../../lib/fileName.ts';
import { pickTextFile } from '../../lib/pickFile';
import { readSetting, saveSetting } from '../../lib/viewSettings.ts';
import { useColors, fs } from '../../theme.ts';
import { HashIcon, TransferIcon } from '../controls/icons.tsx';
import { Select, type SelectOption } from '../controls/Select.tsx';
import { Section, SettingRow, SmallDialog } from '../controls/SmallDialog.tsx';
import { Button, SwitchRow } from '../controls/ui.tsx';
import { TodoistImport } from './TodoistImport.tsx';
import { Actions, BusyButton, Failures, Message, messageOf, plural, Progress, ProgressText, Strong, Warnings } from './transferParts.tsx';

const FORMAT_KEY = 'tododav.transferFormat';

type Format = 'ics' | 'todoist' | 'todoist-api';

const FORMATS: SelectOption<Format>[] = [
  { value: 'ics', label: 'iCalendar (.ics)' },
  { value: 'todoist', label: 'Todoist (CSV)' },
  { value: 'todoist-api', label: 'Todoist (account)' },
];

type ImportState =
  | { step: 'idle' }
  | { step: 'ready'; fileName: string; parsed: ParsedImport }
  | { step: 'error'; message: string }
  | { step: 'importing'; done: number; total: number }
  | { step: 'done'; imported: number; skipped: number; failures: string[] };

interface ExportResult {
  message: string;
  error?: boolean;
  warnings: string[];
}

interface Props {
  client: CalDavClient;
  calendars: Calendar[];
  /** The list on screen, chosen at first. */
  calendarHref: string;
  /** The list's order, so a Todoist export lists the tasks as they show here. */
  compare: (a: Task, b: Task) => number;
  /** Tasks were written to these lists behind the app's back: they have to be fetched again. */
  onImported: (calendarHrefs: string[]) => void;
  /** New lists were created on the server (the Todoist import can make one per project). */
  onListsCreated: (created: Calendar[]) => void;
  onClose: () => void;
}

function savedFormat(): Format {
  const saved = readSetting(FORMAT_KEY);
  return FORMATS.find((f) => f.value === saved)?.value ?? 'ics';
}

/** One list in or out as an .ics file or a Todoist CSV, or a whole Todoist account in. */
export function ImportExportModal({ client, calendars, calendarHref, compare, onImported, onListsCreated, onClose }: Props) {
  const colors = useColors();
  const [format, setFormatState] = useState<Format>(savedFormat);
  const [href, setHref] = useState(calendarHref);
  const [includeCompleted, setIncludeCompleted] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [importState, setImportState] = useState<ImportState>({ step: 'idle' });
  const [accountImporting, setAccountImporting] = useState(false);
  const importing = importState.step === 'importing' || accountImporting;
  const busy = exporting || importing;
  const calendar = calendars.find((c) => c.href === href) ?? calendars[0]!;
  const label = { fontSize: fs(13), color: colors.text };

  function setFormat(next: Format) {
    setFormatState(next);
    saveSetting(FORMAT_KEY, next);
    setExportResult(null);
    setImportState({ step: 'idle' });
  }

  function selectList(next: string) {
    setHref(next);
    setExportResult(null);
    if (importState.step === 'done' || importState.step === 'error') setImportState({ step: 'idle' });
  }

  async function runExport() {
    setExporting(true);
    setExportResult(null);
    try {
      // Fresh from the server, so the file has everything, including what other apps stored.
      const tasks = await client.listTasks(calendar.href);
      if (format === 'ics') {
        const chosen = includeCompleted ? tasks : tasks.filter((t) => !t.completed);
        await download(fileName(calendar.name, 'ics'), tasksToIcs(chosen, calendar.name), 'text/calendar');
        setExportResult({ message: `Exported ${plural(chosen.length, 'task')}.`, warnings: [] });
      } else {
        const { csv, count, warnings } = tasksToTodoist(tasks, compare);
        await download(fileName(calendar.name, 'csv'), csv, 'text/csv');
        setExportResult({ message: `Exported ${plural(count, 'open task')}.`, warnings });
      }
    } catch (error) {
      setExportResult({ message: messageOf(error), error: true, warnings: [] });
    } finally {
      setExporting(false);
    }
  }

  async function chooseFile() {
    try {
      const file = await pickTextFile(format === 'ics' ? ['.ics', 'text/calendar'] : ['.csv', 'text/csv']);
      if (!file) return;
      const parsed = format === 'ics' ? icsToTasks(file.text) : todoistToTasks(file.text);
      setImportState(
        parsed.items.length > 0
          ? { step: 'ready', fileName: file.name, parsed }
          : { step: 'error', message: `There are no tasks in ${file.name}.` },
      );
    } catch (error) {
      setImportState({ step: 'error', message: messageOf(error) });
    }
  }

  async function runImport(items: ImportItem[]) {
    setImportState({ step: 'importing', done: 0, total: items.length });
    try {
      const result = await storeTasks(client, [{ href: calendar.href, items }], (done, total) =>
        setImportState({ step: 'importing', done, total }),
      );
      if (result.changed.length > 0) onImported(result.changed);
      setImportState({ step: 'done', ...result });
    } catch (error) {
      setImportState({ step: 'error', message: messageOf(error) });
    }
  }

  return (
    <SmallDialog
      label="Import and export"
      icon={<TransferIcon color={colors.textSecondary} size={16} />}
      onClose={onClose}
      // Closing mid-import would hide how it went, so every way out waits for it.
      closeDisabled={importing}
    >
      <Section>
        <SettingRow label="Format">
          <Select aria-label="Format" value={format} disabled={busy} onChange={setFormat} options={FORMATS} />
        </SettingRow>
        {calendars.length > 1 && format !== 'todoist-api' && (
          <SettingRow label="Task list">
            <Select
              aria-label="Task list"
              value={calendar.href}
              disabled={busy}
              onChange={selectList}
              options={calendars.map((c) => ({
                value: c.href,
                label: c.name,
                icon: <HashIcon color={c.color ?? colors.textSecondary} />,
              }))}
            />
          </SettingRow>
        )}
      </Section>

      {format === 'todoist-api' ? (
        <TodoistImport
          client={client}
          calendars={calendars}
          calendarHref={calendarHref}
          onBusyChange={setAccountImporting}
          onImported={onImported}
          onListsCreated={onListsCreated}
        />
      ) : (
        <>
          <Section title="Export">
            {format === 'ics' ? (
              <Message>
                Downloads every task of <Strong>{calendar.name}</Strong> as one .ics file, with everything other apps
                stored in them (reminders, repeats...). Most task apps can import it.
              </Message>
            ) : (
              <Message>
                Downloads the open tasks of <Strong>{calendar.name}</Strong> in Todoist's CSV format, with sub-tasks,
                priorities, labels, dates and repeats; the location and link go in a comment. Completed tasks are left
                out, as in Todoist's own export. In Todoist, open a project's <Strong>⋯ menu → Import from CSV</Strong>.
              </Message>
            )}
            {format === 'ics' && (
              <SwitchRow
                label="Include completed tasks"
                value={includeCompleted}
                onChange={setIncludeCompleted}
                labelStyle={label}
              />
            )}
            <Actions>
              <BusyButton label="Export" busyLabel="Exporting" busy={exporting} disabled={busy} onPress={() => void runExport()} />
              {exportResult && <Message tone={exportResult.error ? 'error' : 'status'}>{exportResult.message}</Message>}
            </Actions>
            <Warnings warnings={exportResult?.warnings ?? []} />
          </Section>

          <Section title="Import">
            {format === 'ics' ? (
              <Message>
                Adds the tasks of an .ics file to <Strong>{calendar.name}</Strong>. Tasks already in it are skipped, so
                importing the same file twice adds nothing.
              </Message>
            ) : (
              <Message>
                Adds the tasks of a Todoist CSV export (or Todoist's template) to <Strong>{calendar.name}</Strong>.
                Comments go into the description, and section names become labels.
              </Message>
            )}
            <ImportStep state={importState} busy={busy} onChoose={() => void chooseFile()} onImport={(items) => void runImport(items)} />
          </Section>
        </>
      )}
    </SmallDialog>
  );
}

interface ImportStepProps {
  state: ImportState;
  busy: boolean;
  onChoose: () => void;
  onImport: (items: ImportItem[]) => void;
}

function ImportStep({ state, busy, onChoose, onImport }: ImportStepProps) {
  const chooser = (
    <Button label={state.step === 'ready' ? 'Choose another file' : 'Choose file'} disabled={busy} onPress={onChoose} />
  );

  switch (state.step) {
    case 'idle':
      return <Actions>{chooser}</Actions>;
    case 'error':
      return (
        <>
          <Message tone="error">{state.message}</Message>
          <Actions>{chooser}</Actions>
        </>
      );
    case 'ready': {
      const { items, warnings } = state.parsed;
      return (
        <>
          <Message>
            <Strong>{state.fileName}</Strong>: {plural(items.length, 'task')} found.
          </Message>
          <Warnings warnings={warnings} />
          <Actions>
            <Button label={`Import ${plural(items.length, 'task')}`} variant="primary" disabled={busy} onPress={() => onImport(items)} />
            {chooser}
          </Actions>
        </>
      );
    }
    case 'importing':
      return (
        <Progress label="Importing">
          <ProgressText>
            Importing {state.done} of {state.total}...
          </ProgressText>
        </Progress>
      );
    case 'done':
      return (
        <>
          <Message tone="status">
            Imported {plural(state.imported, 'task')}.
            {state.skipped > 0 &&
              ` ${plural(state.skipped, 'task')} ${state.skipped === 1 ? 'was' : 'were'} already in the list.`}
          </Message>
          <Failures title={`${plural(state.failures.length, 'task')} could not be saved:`} failures={state.failures} />
          <Actions>{chooser}</Actions>
        </>
      );
  }
}
