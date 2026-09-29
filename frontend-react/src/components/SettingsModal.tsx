import { useEffect } from 'react';
import { DEFAULT_SETTINGS, ROW_FIELD_NAMES, type ListLayout, type ViewSettings } from '../viewSettings.ts';
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, GearIcon, TransferIcon } from './icons.tsx';

interface Props {
  settings: ViewSettings;
  /** Changes apply at once, so the list behind shows the result. */
  onChange: (settings: ViewSettings) => void;
  /** Opens the import and export dialog in place of this one. Absent when there is no task list. */
  onImportExport?: () => void;
  onClose: () => void;
}

export function SettingsModal({ settings, onChange, onImportExport, onClose }: Props) {
  const { layout, fields } = settings;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setLayout = (patch: Partial<ListLayout>) => onChange({ ...settings, layout: { ...layout, ...patch } });

  function setVisible(index: number, visible: boolean) {
    onChange({ ...settings, fields: fields.map((f, i) => (i === index ? { ...f, visible } : f)) });
  }

  function move(index: number, by: -1 | 1) {
    const next = [...fields];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved!);
    onChange({ ...settings, fields: next });
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal modal-small" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="modal-header">
          <span className="modal-crumb">
            <GearIcon width={16} height={16} />
            Settings
          </span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <h2>List</h2>
            <div className="settings-row">
              <label className="switch settings-switch">
                <input
                  type="checkbox"
                  checked={layout.nestSubtasks}
                  onChange={(e) => setLayout({ nestSubtasks: e.target.checked })}
                />
                <span className="switch-track" aria-hidden="true" />
                Show sub-tasks under their parent
              </label>
            </div>
            <label className="settings-row">
              <span className="settings-label">Tasks without a due date</span>
              <select
                className="settings-select"
                value={layout.undatedFirst ? 'first' : 'last'}
                onChange={(e) => setLayout({ undatedFirst: e.target.value === 'first' })}
              >
                <option value="last">At the end</option>
                <option value="first">At the top</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <h2>Task page</h2>
            <div className="settings-row">
              <label className="switch settings-switch">
                <input
                  type="checkbox"
                  checked={settings.showMap}
                  onChange={(e) => onChange({ ...settings, showMap: e.target.checked })}
                />
                <span className="switch-track" aria-hidden="true" />
                Show a map of the location
              </label>
            </div>
            <p className="muted settings-note">The map comes from Google, so the location is sent to Google to show it.</p>
          </section>

          <section className="settings-section">
            <h2>Task details</h2>
            <p className="muted">What each task shows under its name, from top to bottom.</p>
            <ul className="field-list">
              {fields.map(({ field, visible }, index) => (
                <li key={field} className={visible ? undefined : 'field-hidden'}>
                  <label className="switch">
                    <input type="checkbox" checked={visible} onChange={(e) => setVisible(index, e.target.checked)} />
                    <span className="switch-track" aria-hidden="true" />
                    {ROW_FIELD_NAMES[field]}
                  </label>
                  <button
                    type="button"
                    className="icon-btn icon-btn-small"
                    aria-label={`Move ${ROW_FIELD_NAMES[field].toLowerCase()} up`}
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUpIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-small"
                    aria-label={`Move ${ROW_FIELD_NAMES[field].toLowerCase()} down`}
                    title="Move down"
                    disabled={index === fields.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDownIcon />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {onImportExport && (
            <section className="settings-section">
              <h2>Import and export</h2>
              <div className="settings-row">
                <p className="muted settings-note">Move tasks in or out as an .ics file or a Todoist CSV.</p>
                <button type="button" className="btn btn-secondary settings-button" onClick={onImportExport}>
                  <TransferIcon width={16} height={16} />
                  Import or export
                </button>
              </div>
            </section>
          )}
        </div>

        <footer className="modal-footer">
          {/* Filters have their own modal and their own Clear. */}
          <button
            type="button"
            className="btn btn-link"
            onClick={() => onChange({ ...DEFAULT_SETTINGS, filters: settings.filters })}
          >
            Reset to defaults
          </button>
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
