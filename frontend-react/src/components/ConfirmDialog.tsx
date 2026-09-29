import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  /** Leaves the confirm button shown but unusable (the message should say why). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** A third choice between Cancel and the confirm button, such as "Discard" next to "Save". */
  alternative?: { label: string; onClick: () => void };
}

/** A small in-app replacement for window.confirm, drawn above whatever modal asked. */
export function ConfirmDialog({ title, message, confirmLabel, confirmDisabled = false, onConfirm, onCancel, alternative }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button (so Enter confirms, like Todoist) and give focus back when done.
  // When it can't be used, Cancel takes the focus: Enter must never pick the destructive choice.
  useEffect(() => {
    const previous = document.activeElement;
    (confirmDisabled ? cancelRef : confirmRef).current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
    // Only on opening: the focus shouldn't jump while the dialog is up.
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
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          {alternative && (
            <button type="button" className="btn btn-secondary" onClick={alternative.onClick}>
              {alternative.label}
            </button>
          )}
          <button ref={confirmRef} type="button" className="btn btn-primary" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
