"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef } from "react";
import { useState } from "react";
import { TerminalEntry } from "@/lib/types";

type TerminalProps = {
  entries: TerminalEntry[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onHistoryUp?: () => void;
  onHistoryDown?: () => void;
  focusSignal: number;
  prompt: string;
  username: string;
  backButtonLabel?: string;
  onBack?: () => void;
  onInterrupt?: () => void;
  stdinMode?: boolean;
  readOnly?: boolean;
  stateBanner?: {
    title: string;
    description: string;
    tone: "info" | "warning" | "success" | "danger";
  } | null;
};

export function Terminal({
  entries,
  inputValue,
  onInputChange,
  onSubmit,
  onHistoryUp,
  onHistoryDown,
  focusSignal,
  prompt,
  username,
  backButtonLabel,
  onBack,
  onInterrupt,
  stdinMode = false,
  readOnly = false,
  stateBanner = null,
}: TerminalProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const terminalBodyRef = useRef<HTMLDivElement | null>(null);
  const [readOnlyHint, setReadOnlyHint] = useState(false);

  const focusTerminal = () => {
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    focusTerminal();
  }, [entries]);

  useEffect(() => {
    focusTerminal();
  }, []);

  useEffect(() => {
    focusTerminal();
  }, [focusSignal]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) {
      setReadOnlyHint(true);
      setTimeout(() => setReadOnlyHint(false), 1200);
      return;
    }
    onSubmit();
    focusTerminal();
  };

  const handleTerminalKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (document.activeElement === inputRef.current) {
      return;
    }
    if (readOnly) {
      setReadOnlyHint(true);
      setTimeout(() => setReadOnlyHint(false), 1200);
      return;
    }

    focusTerminal();

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      onInputChange(inputValue + event.key);
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      onInputChange(inputValue.slice(0, -1));
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      onInterrupt?.();
      return;
    }

    if (event.key === "ArrowUp" && !stdinMode) {
      event.preventDefault();
      onHistoryUp?.();
      return;
    }

    if (event.key === "ArrowDown" && !stdinMode) {
      event.preventDefault();
      onHistoryDown?.();
      return;
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900 shadow-[0_18px_40px_-22px_rgba(0,0,0,0.7)]">
      <div className="flex items-center justify-between border-b border-zinc-700/80 bg-zinc-800/90 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-500" />
          <span className="h-3 w-3 rounded-full bg-yellow-400" />
          <span className="h-3 w-3 rounded-full bg-green-500" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-300">{username}@ubuntu: ~</span>
        </div>
        <div className="flex gap-2">
          {onBack && backButtonLabel ? (
            <button
              type="button"
              onClick={onBack}
              className="rounded-md bg-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-100 hover:bg-zinc-600"
            >
              {backButtonLabel}
            </button>
          ) : null}
        </div>
      </div>

      <div
        ref={terminalBodyRef}
        tabIndex={0}
        onClick={focusTerminal}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            focusTerminal();
          }
        }}
        onKeyDown={handleTerminalKeyDown}
        className="min-h-[320px] flex-1 overflow-y-auto bg-black p-4 font-mono text-sm text-zinc-100 outline-none min-[900px]:min-h-[420px]"
      >
        {entries.length === 0 ? (
          <p className="text-zinc-400">Ketik `help` untuk melihat command yang tersedia.</p>
        ) : null}

        {entries.map((entry) => (
          <div key={entry.id} className="mb-2">
            <p>
              <span className="text-green-400">{username}@ubuntu</span>
              <span className="text-zinc-100">
                {entry.prompt.replace(`${username}@ubuntu`, "")}
              </span>{" "}
              {entry.command}
            </p>
            {entry.output.map((line, index) => (
              <p key={`${entry.id}-${index}`} className="whitespace-pre text-zinc-200">
                {line}
              </p>
            ))}
          </div>
        ))}

        {stateBanner ? (
          <div
            className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
              stateBanner.tone === "success"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : stateBanner.tone === "warning"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                  : stateBanner.tone === "danger"
                    ? "border-red-500/40 bg-red-500/10 text-red-200"
                    : "border-sky-500/40 bg-sky-500/10 text-sky-200"
            }`}
          >
            <p className="font-semibold">{stateBanner.title}</p>
            <p className="mt-0.5 whitespace-pre-line opacity-90">{stateBanner.description}</p>
          </div>
        ) : null}

        <div ref={endRef} />
      </div>
      <div className="border-t border-zinc-800 bg-black px-4 py-2">
        {readOnly ? (
          <div className="rounded-md border border-zinc-700/80 bg-zinc-900/70 px-3 py-2 text-xs text-zinc-400">
            Input terminal dinonaktifkan (read-only).
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            {stdinMode ? (
              <label htmlFor="terminal-input" className="text-yellow-300">
                stdin&gt;
              </label>
            ) : (
              <label htmlFor="terminal-input" className="text-zinc-100">
                <span className="text-green-400">{username}@ubuntu</span>
                {prompt.replace(`${username}@ubuntu`, "")}
              </label>
            )}
            <input
              id="terminal-input"
              ref={inputRef}
              className="flex-1 w-full min-w-0 bg-transparent text-zinc-100 outline-none caret-zinc-100"
              value={inputValue}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={handleInputKeyDown}
              autoComplete="off"
              spellCheck={false}
              readOnly={readOnly}
              disabled={readOnly}
            />
          </form>
        )}
        {readOnlyHint ? (
          <p className="mt-1 text-xs text-blue-300">Mode read-only aktif. Ujian sudah disubmit.</p>
        ) : null}
        {stdinMode ? (
          <p className="mt-1 text-xs text-yellow-300">Mode input program aktif. Ketik jawaban lalu Enter.</p>
        ) : null}
      </div>
    </section>
  );
}
