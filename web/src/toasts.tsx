import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
  action?: { label: string; run: () => void };
}

interface ToastApi {
  push(message: string, kind?: Toast["kind"], action?: Toast["action"]): void;
}

const Ctx = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const push = useCallback<ToastApi["push"]>((message, kind = "info", action) => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-3), { id, kind, message, action }]);
    window.setTimeout(() => dismiss(id), kind === "error" ? 8000 : 5000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.message}</span>
            {t.action && (
              <button className="btn btn-ghost btn-sm" onClick={() => { t.action!.run(); dismiss(t.id); }}>
                {t.action.label}
              </button>
            )}
            <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}
