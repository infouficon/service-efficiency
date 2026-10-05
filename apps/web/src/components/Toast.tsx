import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  exiting?: boolean;
}

export interface ToastContextValue {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

const ICONS: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

function ToastElement({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const Icon = ICONS[toast.type];

  return (
    <div
      className={`toast-card toast-${toast.type} ${toast.exiting ? 'toast-exit' : 'toast-enter'}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
    >
      <div className="toast-icon">
        <Icon size={20} />
      </div>
      <div className="toast-message">{toast.message}</div>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="ปิดการแจ้งเตือน"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timeoutsRef = useRef<Map<string, { dismissTimer: NodeJS.Timeout; removeTimer?: NodeJS.Timeout }>>(
    new Map(),
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timers = timeoutsRef.current.get(id);
    if (timers) {
      clearTimeout(timers.dismissTimer);
      if (timers.removeTimer) clearTimeout(timers.removeTimer);
      timeoutsRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
      );
      const removeTimer = setTimeout(() => {
        removeToast(id);
      }, 250); // wait for fade out animation

      const timers = timeoutsRef.current.get(id);
      if (timers) {
        timers.removeTimer = removeTimer;
      }
    },
    [removeToast],
  );

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration = 3000) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newToast: ToastItem = { id, message, type, duration };

      setToasts((prev) => [...prev, newToast]);

      const dismissTimer = setTimeout(() => {
        dismiss(id);
      }, duration);

      timeoutsRef.current.set(id, { dismissTimer });
    },
    [dismiss],
  );

  const success = useCallback(
    (message: string, duration = 3000) => showToast(message, 'success', duration),
    [showToast],
  );

  const error = useCallback(
    (message: string, duration = 4000) => showToast(message, 'error', duration),
    [showToast],
  );

  const info = useCallback(
    (message: string, duration = 3000) => showToast(message, 'info', duration),
    [showToast],
  );

  const warning = useCallback(
    (message: string, duration = 3500) => showToast(message, 'warning', duration),
    [showToast],
  );

  useEffect(() => {
    const currentTimers = timeoutsRef.current;
    return () => {
      currentTimers.forEach((timers) => {
        clearTimeout(timers.dismissTimer);
        if (timers.removeTimer) clearTimeout(timers.removeTimer);
      });
      currentTimers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider
      value={{ showToast, success, error, info, warning, dismiss }}
    >
      {children}
      <div className="toast-container" aria-label="Notifications">
        {toasts.map((toast) => (
          <ToastElement key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
