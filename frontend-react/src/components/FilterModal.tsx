import { useEffect } from 'react';
import type { Priority } from '../api/tasks.ts';
import { ALL_PRIORITIES, DEFAULT_SETTINGS, DUE_FILTER_NAMES, filtersActive, type DueFilter, type Filters } from '../viewSettings.ts';
import { CloseIcon, FilterIcon, FlagIcon } from './icons.tsx';

interface Props {
  filters: Filters;
  /** Labels used in the current list. */
  labels: string[];
  /** Changes apply at once, so the list behind shows the result. */
  onChange: (filters: Filters) => void;
  onClose: () => void;
}

export function FilterModal({ filters, labels, onChange, onClose }: Props) {
  // A label chosen in another list stays selectable, so the filter can be seen and undone.
  const labelOptions = filters.label && !labels.includes(filters.label) ? [filters.label, ...labels] : labels;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  function togglePriority(priority: Priority) {
    const next = filters.priorities.includes(priority)
      ? filters.priorities.filter((p) => p !== priority)
      : ALL_PRIORITIES.filter((p) => p === priority || filters.priorities.includes(p));
    update({ priorities: next });
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal modal-small" role="dialog" aria-modal="true" aria-label="Filters">
        <header className="modal-header">
          <span className="modal-crumb">
            <FilterIcon width={16} height={16} />
            Filters
          </span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <div className="settings-row">
              <span className="settings-label" id="priority-filter">
                Priority
              </span>
              <div className="priority-toggles" role="group" aria-labelledby="priority-filter">
                {ALL_PRIORITIES.map((p) => {
                  const on = filters.priorities.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      className={`priority-toggle p${p}`}
                      aria-pressed={on}
                      // At least one priority stays on: an empty list would only look broken.
                      disabled={on && filters.priorities.length === 1}
                      title={`Priority ${p}`}
                      onClick={() => togglePriority(p)}
                    >
                      <FlagIcon />P{p}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="settings-row">
              <span className="settings-label">Due date</span>
              <select
                className="settings-select"
                value={filters.due}
                onChange={(e) => update({ due: e.target.value as DueFilter })}
              >
                {Object.entries(DUE_FILTER_NAMES).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-row">
              <span className="settings-label">Label</span>
              <select
                className="settings-select"
                value={filters.label ?? ''}
                onChange={(e) => update({ label: e.target.value || undefined })}
              >
                <option value="">Any label</option>
                {labelOptions.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </div>

        <footer className="modal-footer">
          <button
            type="button"
            className="btn btn-link"
            disabled={!filtersActive(filters)}
            onClick={() => onChange(DEFAULT_SETTINGS.filters)}
          >
            Clear filters
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
