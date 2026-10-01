import { useRef, useState } from 'react';

export interface ToastMessage {
  message: string;
  /** A button in the toast, such as Undo or Retry. */
  action?: { label: string; run: () => void };
}

/** One toast at a time, gone after 5 seconds or once its button is used. */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function show(next: ToastMessage) {
    clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), 5000);
  }

  const element = toast && (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action?.run();
            setToast(null);
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );

  return { show, element };
}
