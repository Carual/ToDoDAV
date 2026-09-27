import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A small in-app replacement for window.confirm, drawn above whatever modal asked. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button (so Enter confirms, like Todoist) and give focus back when done.
  useEffect(() => {
    const previous = document.activeElement;
    confirmRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Capture phase + stopPropagation: the modal underneath must not also react to this Escape.
      event.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <div className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-body">
          <h2 id="confirm-title">{title}</h2>
          <p>{message}</p>
        </div>
        <footer className="confirm-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button ref={confirmRef} type="button" className="btn btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
