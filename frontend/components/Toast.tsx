"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
} from "react";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

type Action = { type: "ADD"; toast: Toast } | { type: "REMOVE"; id: string };

interface ToastCtx {
  toast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastCtx | null>(null);

function reducer(state: Toast[], action: Action): Toast[] {
  if (action.type === "ADD") return [...state, action.toast];
  if (action.type === "REMOVE") return state.filter((t) => t.id !== action.id);
  return state;
}

const STYLES: Record<ToastType, { bar: string; icon: string; Icon: React.FC<{ className?: string }> }> = {
  success: { bar: "border-teal/40 bg-teal/8",   icon: "text-teal",   Icon: CheckCircle },
  error:   { bar: "border-red/40 bg-red/8",      icon: "text-red",    Icon: XCircle },
  warning: { bar: "border-gold/40 bg-gold/8",    icon: "text-gold",   Icon: AlertTriangle },
  info:    { bar: "border-violet/40 bg-violet/8",icon: "text-violet", Icon: Info },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { bar, icon, Icon } = STYLES[toast.type];
  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 px-4 py-3 border ${bar} backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-200`}
    >
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${icon}`} />
      <p className="flex-1 font-mono text-xs text-ink leading-relaxed">{toast.message}</p>
      <button onClick={onDismiss} className="shrink-0 text-muted hover:text-ink transition-colors">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, []);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = Math.random().toString(36).slice(2);
    dispatch({ type: "ADD", toast: { id, type, message } });
    setTimeout(() => dispatch({ type: "REMOVE", id }), 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 w-80 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem
            key={t.id}
            toast={t}
            onDismiss={() => dispatch({ type: "REMOVE", id: t.id })}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx.toast;
}
