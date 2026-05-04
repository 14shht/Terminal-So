"use client";

import CodeMirror from "@uiw/react-codemirror";
import { cpp } from "@codemirror/lang-cpp";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { EditorView } from "@codemirror/view";

type EditorModalProps = {
  isOpen: boolean;
  filename: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onSaveAndClose: () => void;
  onClose: () => void;
};

export function EditorModal({
  isOpen,
  filename,
  value,
  onChange,
  onSave,
  onSaveAndClose,
  onClose,
}: EditorModalProps) {
  if (!isOpen) {
    return null;
  }

  const editorExtensions = (() => {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".c") || lower.endsWith(".h")) {
      return [cpp()];
    }

    if (lower.endsWith(".sh")) {
      return [StreamLanguage.define(shell)];
    }

    return [];
  })();

  const editorTheme = EditorView.theme({
    "&": {
      backgroundColor: "#ffffff",
      color: "#111827",
      fontSize: "15px",
      height: "520px",
    },
    ".cm-editor": {
      height: "520px",
    },
    ".cm-scroller": {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
      overflow: "auto",
    },
    ".cm-content": {
      padding: "12px 0",
      minHeight: "520px",
    },
    ".cm-gutters": {
      backgroundColor: "#f3f4f6",
      color: "#4b5563",
      borderRight: "1px solid #d1d5db",
    },
    ".cm-activeLine": {
      backgroundColor: "#eaf6ff",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#dbeafe",
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-5xl rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
        <div className="relative mb-3 min-h-10">
          <h2 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-lg font-semibold text-zinc-100">
            gedit - {filename}
          </h2>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onSave}
              className="rounded-md bg-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-zinc-600"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onSaveAndClose}
              className="rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-orange-400"
            >
              Save & Close
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-red-500"
            >
              Close
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-zinc-600 bg-white text-black">
          <CodeMirror
            value={value}
            height="520px"
            theme="light"
            extensions={[...editorExtensions, editorTheme]}
            onChange={(nextValue) => onChange(nextValue)}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              highlightActiveLineGutter: true,
              indentOnInput: true,
              foldGutter: true,
            }}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <p className="text-xs text-zinc-400">
            Extensi .c/.h menggunakan mode C/C++, .sh menggunakan mode shell, lainnya plain text.
          </p>
        </div>
      </div>
    </div>
  );
}
