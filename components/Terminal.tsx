"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef } from "react";
import { TerminalEntry } from "@/lib/types";

type TerminalProps = {
  entries: TerminalEntry[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  onReset: () => void;
  focusSignal: number;
  prompt: string;
  username: string;
  onSubmitExam: () => void;
  onLogout: () => void;
  submitted: boolean;
};

export function Terminal({
  entries,
  inputValue,
  onInputChange,
  onSubmit,
  onClear,
  onReset,
  focusSignal,
  prompt,
  username,
  onSubmitExam,
  onLogout,
  submitted,
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
    onSubmit();
    focusTerminal();
  };

  const handleTerminalKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (document.activeElement === inputRef.current) {
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
    <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-800/80 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-500" />
          <span className="h-3 w-3 rounded-full bg-yellow-400" />
          <span className="h-3 w-3 rounded-full bg-green-500" />
        </div>
        <span className="text-xs text-zinc-300">{username}@ubuntu: ~</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSubmitExam}
            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-zinc-100 hover:bg-blue-500"
          >
            {submitted ? "Submitted" : "Submit Ujian"}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-md bg-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-100 hover:bg-zinc-600"
          >
            Logout
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-md bg-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-100 hover:bg-zinc-600"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-zinc-100 hover:bg-red-500"
          >
            Reset
          </button>
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
        className="h-[72vh] overflow-y-auto bg-black p-4 font-mono text-sm text-zinc-100 outline-none md:h-[76vh]"
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
              <p key={`${entry.id}-${index}`} className="whitespace-pre-wrap text-zinc-200">
                {line}
              </p>
            ))}
          </div>
        ))}

        <form onSubmit={handleSubmit} className="mt-2 flex items-center gap-2">
          <label htmlFor="terminal-input" className="text-zinc-100">
            <span className="text-green-400">{username}@ubuntu</span>
            {prompt.replace(`${username}@ubuntu`, "")}
          </label>
          <input
            id="terminal-input"
            ref={inputRef}
            className="flex-1 w-full min-w-0 bg-transparent text-zinc-100 outline-none caret-zinc-100"
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </form>
        <div ref={endRef} />
      </div>
    </section>
  );
}
