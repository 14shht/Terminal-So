"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef } from "react";
import { TerminalEntry } from "@/lib/types";

type TerminalProps = {
  entries: TerminalEntry[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  focusSignal: number;
  prompt: string;
  username: string;
  backButtonLabel?: string;
  onBack?: () => void;
  stdinMode?: boolean;
  readOnly?: boolean;
};

export function Terminal({
  entries,
  inputValue,
  onInputChange,
  onSubmit,
  focusSignal,
  prompt,
  username,
  backButtonLabel,
  onBack,
  stdinMode = false,
  readOnly = false,
}: TerminalProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const terminalBodyRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900 shadow-[0_18px_40px_-22px_rgba(0,0,0,0.7)]">
      <div className="flex items-center justify-between border-b border-zinc-700/80 bg-zinc-800/90 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-500" />
          <span className="h-3 w-3 rounded-full bg-yellow-400" />
          <span className="h-3 w-3 rounded-full bg-green-500" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-300">{username}@ubuntu: ~</span>
          {readOnly ? (
            <span className="rounded-full bg-blue-600/20 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
              Sudah Disubmit
            </span>
          ) : null}
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
        className="h-[62vh] min-h-[420px] overflow-y-auto bg-black p-4 font-mono text-sm text-zinc-100 outline-none md:h-[calc(100vh-260px)]"
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

        <form onSubmit={handleSubmit} className="mt-2 flex items-center gap-2">
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
            autoComplete="off"
            spellCheck={false}
            readOnly={readOnly}
            disabled={readOnly}
          />
        </form>
        {readOnly ? (
          <p className="mt-1 text-xs text-blue-300">Mode read only aktif. Ujian sudah disubmit.</p>
        ) : null}
        {stdinMode ? (
          <p className="mt-1 text-xs text-yellow-300">Mode input program aktif. Ketik jawaban lalu Enter.</p>
        ) : null}
        <div ref={endRef} />
      </div>
    </section>
  );
}
