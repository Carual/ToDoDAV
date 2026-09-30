import { useEffect, useState, type ChangeEvent } from 'react';
import type { Calendar, CalDavClient } from '../api/caldav.ts';
import { icsToTasks, tasksToIcs, type ImportItem, type ParsedImport } from '../api/icsFile.ts';
import { storeTasks } from '../api/importTasks.ts';
import type { Task } from '../api/tasks.ts';
import { tasksToTodoist, todoistToTasks } from '../api/todoist.ts';
import { download, fileName } from '../download.ts';
import { readSetting, saveSetting } from '../viewSettings.ts';
import { CloseIcon, HashIcon, TransferIcon } from './icons.tsx';
import { Select, type SelectOption } from './Select.tsx';
import { Spinner } from './Spinner.tsx';
import { TodoistImport } from './TodoistImport.tsx';
import { Warnings } from './Warnings.tsx';

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

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

function savedFormat(): Format {
  const saved = readSetting(FORMAT_KEY);
  return FORMATS.find((f) => f.value === saved)?.value ?? 'ics';
}

export function ImportExportModal({ client, calendars, calendarHref, compare, onImported, onListsCreated, onClose }: Props) {
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

  // Closing mid-import would hide how it went, so the way out waits for it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !importing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, importing]);

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
        download(fileName(calendar.name, 'ics'), tasksToIcs(chosen, calendar.name), 'text/calendar');
        setExportResult({ message: `Exported ${plural(chosen.length, 'task')}.`, warnings: [] });
      } else {
        const { csv, count, warnings } = tasksToTodoist(tasks, compare);
        download(fileName(calendar.name, 'csv'), csv, 'text/csv');
        setExportResult({ message: `Exported ${plural(count, 'open task')}.`, warnings });
      }
    } catch (error) {
      setExportResult({ message: messageOf(error), error: true, warnings: [] });
    } finally {
      setExporting(false);
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // so picking the same file again (after fixing it) still counts
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = format === 'ics' ? icsToTasks(text) : todoistToTasks(text);
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
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !importing && onClose()}>
      <div className="modal modal-small" role="dialog" aria-modal="true" aria-label="Import and export">
        <header className="modal-header">
          <span className="modal-crumb">
            <TransferIcon width={16} height={16} />
            Import and export
          </span>
          <button type="button" className="icon-btn" aria-label="Close" disabled={importing} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <div className="settings-row">
              <span className="settings-label">Format</span>
              <Select
                className="settings-select"
                aria-label="Format"
                value={format}
                disabled={busy}
                onChange={setFormat}
                options={FORMATS}
              />
            </div>
            {calendars.length > 1 && format !== 'todoist-api' && (
              <div className="settings-row">
                <span className="settings-label">Task list</span>
                <Select
                  className="settings-select"
                  aria-label="Task list"
                  value={calendar.href}
                  disabled={busy}
                  onChange={selectList}
                  options={calendars.map((c) => ({
                    value: c.href,
                    label: c.name,
                    icon: <HashIcon className="select-icon" style={{ color: c.color }} />,
                  }))}
                />
              </div>
            )}
          </section>

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
              <section className="settings-section">
                <h2>Export</h2>
                {format === 'ics' ? (
                  <p className="muted">
                    Downloads every task of <strong>{calendar.name}</strong> as one .ics file, with everything other apps
                    stored in them (reminders, repeats...). Most task apps can import it.
                  </p>
                ) : (
                  <p className="muted">
                    Downloads the open tasks of <strong>{calendar.name}</strong> in Todoist's CSV format, with sub-tasks,
                    priorities, labels, dates and repeats; the location and link go in a comment. Completed tasks are left
                    out, as in Todoist's own export. In Todoist, open a project's <strong>⋯ menu → Import from CSV</strong>.
                  </p>
                )}
                {format === 'ics' && (
                  <div className="settings-row">
                    <label className="switch settings-switch">
                      <input
                        type="checkbox"
                        checked={includeCompleted}
                        onChange={(e) => setIncludeCompleted(e.target.checked)}
                      />
                      <span className="switch-track" aria-hidden="true" />
                      Include completed tasks
                    </label>
                  </div>
                )}
                <div className="transfer-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    aria-busy={exporting}
                    onClick={() => void runExport()}
                  >
                    {exporting ? <Spinner label="Exporting" /> : 'Export'}
                  </button>
                  {exportResult && (
                    <span className={exportResult.error ? 'form-error transfer-status' : 'transfer-status'} role="status">
                      {exportResult.message}
                    </span>
                  )}
                </div>
                <Warnings warnings={exportResult?.warnings ?? []} />
              </section>

              <section className="settings-section">
                <h2>Import</h2>
                {format === 'ics' ? (
                  <p className="muted">
                    Adds the tasks of an .ics file to <strong>{calendar.name}</strong>. Tasks already in it are skipped, so
                    importing the same file twice adds nothing.
                  </p>
                ) : (
                  <p className="muted">
                    Adds the tasks of a Todoist CSV export (or Todoist's template) to <strong>{calendar.name}</strong>.
                    Comments go into the description, and section names become labels.
                  </p>
                )}
                <ImportStep state={importState} onChoose={chooseFile} onImport={runImport} format={format} busy={busy} />
              </section>
            </>
          )}
        </div>

        <footer className="modal-footer">
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-primary" disabled={importing} onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

interface ImportStepProps {
  state: ImportState;
  format: Format;
  busy: boolean;
  onChoose: (event: ChangeEvent<HTMLInputElement>) => void;
  onImport: (items: ImportItem[]) => void;
}

function ImportStep({ state, format, busy, onChoose, onImport }: ImportStepProps) {
  const chooser = (
    <label className={`btn btn-secondary transfer-file${busy ? ' transfer-file-disabled' : ''}`}>
      {state.step === 'ready' ? 'Choose another file' : 'Choose file'}
      <input
        type="file"
        accept={format === 'ics' ? '.ics,text/calendar' : '.csv,text/csv'}
        disabled={busy}
        onChange={onChoose}
      />
    </label>
  );

  switch (state.step) {
    case 'idle':
      return <div className="transfer-actions">{chooser}</div>;
    case 'error':
      return (
        <>
          <p className="form-error transfer-message">{state.message}</p>
          <div className="transfer-actions">{chooser}</div>
        </>
      );
    case 'ready': {
      const { items, warnings } = state.parsed;
      return (
        <>
          <p className="transfer-message">
            <strong>{state.fileName}</strong>: {plural(items.length, 'task')} found.
          </p>
          <Warnings warnings={warnings} />
          <div className="transfer-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onImport(items)}>
              Import {plural(items.length, 'task')}
            </button>
            {chooser}
          </div>
        </>
      );
    }
    case 'importing':
      return (
        <div className="transfer-progress" role="status">
          <Spinner label="Importing" />
          Importing {state.done} of {state.total}...
        </div>
      );
    case 'done':
      return (
        <>
          <p className="transfer-message" role="status">
            Imported {plural(state.imported, 'task')}.
            {state.skipped > 0 &&
              ` ${plural(state.skipped, 'task')} ${state.skipped === 1 ? 'was' : 'were'} already in the list.`}
          </p>
          {state.failures.length > 0 && (
            <div className="transfer-failures">
              <p className="form-error">{plural(state.failures.length, 'task')} could not be saved:</p>
              <ul>
                {state.failures.map((failure, index) => (
                  <li key={index}>{failure}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="transfer-actions">{chooser}</div>
        </>
      );
  }
}
