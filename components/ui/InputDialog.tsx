"use client";

import * as Dialog from "@radix-ui/react-dialog";

type InputDialogProps = {
  open: boolean;
  title: string;
  description: string;
  value: string;
  label?: string;
  placeholder?: string;
  helperText?: string;
  error?: string;
  inputType?: "text" | "password" | "number";
  cancelLabel?: string;
  submitLabel?: string;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
};

export function InputDialog({
  open,
  title,
  description,
  value,
  label,
  placeholder,
  helperText,
  error,
  inputType = "text",
  cancelLabel = "Batal",
  submitLabel = "Simpan",
  loading = false,
  onOpenChange,
  onValueChange,
  onSubmit,
}: InputDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[100] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)] outline-none">
          <Dialog.Title className="text-lg font-semibold text-zinc-900">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-zinc-600">{description}</Dialog.Description>

          <div className="mt-4">
            {label ? <label className="mb-1 block text-xs font-semibold text-zinc-500">{label}</label> : null}
            <input
              autoFocus
              type={inputType}
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !loading) {
                  event.preventDefault();
                  onSubmit();
                }
              }}
              placeholder={placeholder}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            {helperText ? <p className="mt-1 text-xs text-zinc-500">{helperText}</p> : null}
            {error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : null}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={loading}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60"
              >
                {cancelLabel}
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={onSubmit}
              disabled={loading}
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
            >
              {loading ? "Memproses..." : submitLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

