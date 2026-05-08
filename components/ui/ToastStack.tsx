"use client";

export type AppToast = {
  id: string;
  message: string;
  tone?: "success" | "error";
};

type ToastStackProps = {
  toasts: AppToast[];
  onDismiss: (id: string) => void;
};

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[120] flex w-[calc(100vw-1.5rem)] max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-xl border px-3 py-2 text-sm shadow-lg ${
            toast.tone === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="leading-5">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="rounded p-0.5 text-xs opacity-70 transition hover:opacity-100"
              aria-label="Dismiss toast"
            >
              x
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

