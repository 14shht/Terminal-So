"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type GlobalExamStatus = "NOT_STARTED" | "SCHEDULED" | "RUNNING" | "PAUSED" | "ENDED";

type ExamSessionPayload = {
  status: GlobalExamStatus;
  startTime: string | null;
  endTime: string | null;
  pausedAt: string | null;
  pausedRemainingSeconds: number | null;
  serverTime: string;
  remainingSeconds: number;
};

const statusLabel: Record<GlobalExamStatus, string> = {
  NOT_STARTED: "Belum Dimulai",
  SCHEDULED: "Terjadwal",
  RUNNING: "Berjalan",
  PAUSED: "Dipause",
  ENDED: "Selesai",
};

const statusClass: Record<GlobalExamStatus, string> = {
  NOT_STARTED: "bg-zinc-200 text-zinc-700",
  SCHEDULED: "bg-blue-100 text-blue-700",
  RUNNING: "bg-emerald-100 text-emerald-700",
  PAUSED: "bg-amber-100 text-amber-700",
  ENDED: "bg-rose-100 text-rose-700",
};

const formatDateTimeLocal = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatCountdown = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(safe / 3600).toString().padStart(2, "0");
  const mm = Math.floor((safe % 3600) / 60).toString().padStart(2, "0");
  const ss = (safe % 60).toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

const actionPendingLabel: Record<string, string> = {
  schedule: "Menyimpan...",
  reset: "Mereset...",
  start: "Memulai...",
  pause: "Mem-pause...",
  resume: "Melanjutkan...",
  end: "Mengakhiri...",
};

type Props = {
  onToast: (message: string, tone?: "success" | "error") => void;
};

export function GlobalExamControlPanel({ onToast }: Props) {
  const [session, setSession] = useState<ExamSessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [draftStartTime, setDraftStartTime] = useState("");
  const [draftEndTime, setDraftEndTime] = useState("");
  const [isEditingSchedule, setIsEditingSchedule] = useState(false);
  const [liveRemainingSeconds, setLiveRemainingSeconds] = useState(0);
  const [liveServerTime, setLiveServerTime] = useState<Date | null>(null);
  const [confirmAction, setConfirmAction] = useState<"reset" | "end" | null>(null);
  const toastRef = useRef(onToast);

  useEffect(() => {
    toastRef.current = onToast;
  }, [onToast]);

  const loadSession = useCallback(async () => {
    const response = await fetch("/api/exam-session", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      toastRef.current(data.error || "Gagal memuat kontrol ujian global.", "error");
      return;
    }
    setSession(data.examSession);
    setLiveRemainingSeconds(Math.max(0, Number(data.examSession?.remainingSeconds ?? 0)));
    setLiveServerTime(data.examSession?.serverTime ? new Date(data.examSession.serverTime) : new Date());
    if (!isEditingSchedule) {
      setDraftStartTime(formatDateTimeLocal(data.examSession?.startTime ?? null));
      setDraftEndTime(formatDateTimeLocal(data.examSession?.endTime ?? null));
    }
  }, [isEditingSchedule]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadSession();
      setLoading(false);
    })();
    const poll = setInterval(() => {
      void loadSession();
    }, 5000);
    return () => clearInterval(poll);
  }, [loadSession]);

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveServerTime((prev) => (prev ? new Date(prev.getTime() + 1000) : new Date()));
      setLiveRemainingSeconds((prev) => {
        if (!session) return prev;
        if (session.status === "RUNNING" || session.status === "SCHEDULED") {
          return Math.max(0, prev - 1);
        }
        if (session.status === "PAUSED") {
          return Math.max(0, session.pausedRemainingSeconds ?? prev);
        }
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [session]);

  const derivedRemaining = useMemo(() => {
    if (!session) return 0;
    if (session.status === "RUNNING" || session.status === "SCHEDULED") return Math.max(0, liveRemainingSeconds);
    if (session.status === "PAUSED") {
      return Math.max(0, session.pausedRemainingSeconds ?? liveRemainingSeconds ?? 0);
    }
    return 0;
  }, [session, liveRemainingSeconds]);

  const runAction = async (action: string, endpoint: string, body?: Record<string, unknown>) => {
    try {
      setBusyAction(action);
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        onToast(data.error || "Aksi gagal dijalankan.", "error");
        return;
      }
      setSession((prev) => ({
        ...(prev ?? {}),
        ...(data.examSession ?? {}),
        serverTime: new Date().toISOString(),
        remainingSeconds: data.examSession?.remainingSeconds ?? prev?.remainingSeconds ?? 0,
      }));
      setLiveRemainingSeconds(Math.max(0, Number(data.examSession?.remainingSeconds ?? 0)));
      setLiveServerTime(new Date());
      setIsEditingSchedule(false);
      toastRef.current("Aksi kontrol ujian berhasil disimpan.");
      await loadSession();
    } catch {
      onToast("Terjadi gangguan jaringan. Coba lagi.", "error");
    } finally {
      setBusyAction("");
    }
  };

  if (loading) {
    return (
      <section className="mb-4 rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-[0_15px_40px_-24px_rgba(0,0,0,0.5)] md:p-5">
        <p className="text-sm text-zinc-500">Memuat kontrol ujian global...</p>
      </section>
    );
  }

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_10px_24px_-18px_rgba(0,0,0,0.28)]">
      <div className="bg-[linear-gradient(135deg,#fafafa_0%,#eef2ff_55%,#f5f3ff_100%)] px-4 py-3 md:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600/90">Exam Control</p>
            <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-zinc-900">Kontrol Ujian Global</h2>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-semibold shadow-sm ${statusClass[session?.status ?? "NOT_STARTED"]}`}
          >
            {statusLabel[session?.status ?? "NOT_STARTED"]}
          </span>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="grid gap-2 text-xs text-zinc-600 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Waktu Mulai</p>
            <p className="mt-1 text-[13px] font-semibold text-zinc-800">
              {session?.startTime ? new Date(session.startTime).toLocaleString() : "-"}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Waktu Selesai</p>
            <p className="mt-1 text-[13px] font-semibold text-zinc-800">
              {session?.endTime ? new Date(session.endTime).toLocaleString() : "-"}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Server Time</p>
            <p className="mt-1 text-[13px] font-semibold text-zinc-800">
              {liveServerTime ? liveServerTime.toLocaleTimeString() : "-"}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              {session?.status === "SCHEDULED" ? "Countdown Mulai" : "Sisa Waktu"}
            </p>
            <p className="mt-1 font-mono text-[14px] font-semibold text-zinc-800">{formatCountdown(derivedRemaining)}</p>
          </div>
        </div>

        <div className="grid gap-2.5 md:grid-cols-2">
            <label className="text-xs font-semibold text-zinc-600">
              Tanggal & Jam Mulai
              <input
                type="datetime-local"
                value={draftStartTime}
                onFocus={() => setIsEditingSchedule(true)}
                onChange={(event) => {
                  setDraftStartTime(event.target.value);
                  setIsEditingSchedule(true);
                }}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
            <label className="text-xs font-semibold text-zinc-600">
              Tanggal & Jam Selesai
              <input
                type="datetime-local"
                value={draftEndTime}
                onFocus={() => setIsEditingSchedule(true)}
                onChange={(event) => {
                  setDraftEndTime(event.target.value);
                  setIsEditingSchedule(true);
                }}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
        </div>

        <div className="flex flex-wrap items-center justify-start gap-2 border-t border-zinc-200 pt-2.5">
          <button
            type="button"
            onClick={() =>
              void runAction("schedule", "/api/exam-session/schedule", {
                startTime: draftStartTime,
                endTime: draftEndTime,
              })
            }
            disabled={busyAction.length > 0}
            className="h-8 rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {busyAction === "schedule" ? actionPendingLabel.schedule : "Simpan Jadwal"}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmAction("reset");
            }}
            disabled={busyAction.length > 0}
            className="h-8 rounded-md bg-zinc-700 px-3 text-xs font-semibold text-white transition hover:bg-zinc-600 disabled:opacity-60"
          >
            {busyAction === "reset" ? actionPendingLabel.reset : "Reset Timer"}
          </button>
          <button
            type="button"
            onClick={() => void runAction("start", "/api/exam-session/start-now")}
            disabled={busyAction.length > 0 || session?.status === "RUNNING"}
            className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
          >
            {busyAction === "start" ? actionPendingLabel.start : "Mulai Sekarang"}
          </button>
          <button
            type="button"
            onClick={() => void runAction("pause", "/api/exam-session/pause")}
            disabled={busyAction.length > 0 || session?.status !== "RUNNING"}
            className="h-8 rounded-md bg-amber-500 px-3 text-xs font-semibold text-white transition hover:bg-amber-400 disabled:opacity-60"
          >
            {busyAction === "pause" ? actionPendingLabel.pause : "Pause"}
          </button>
          <button
            type="button"
            onClick={() => void runAction("resume", "/api/exam-session/resume")}
            disabled={busyAction.length > 0 || session?.status !== "PAUSED"}
            className="h-8 rounded-md bg-violet-600 px-3 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
          >
            {busyAction === "resume" ? actionPendingLabel.resume : "Lanjutkan"}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmAction("end");
            }}
            disabled={busyAction.length > 0 || session?.status === "ENDED"}
            className="h-8 rounded-md bg-rose-600 px-3 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60"
          >
            {busyAction === "end" ? actionPendingLabel.end : "Akhiri Ujian"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmAction === "reset"}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Reset Timer"
        description="Yakin ingin reset timer ujian global?"
        confirmLabel="Reset Timer"
        destructive
        loading={busyAction === "reset"}
        onConfirm={() => {
          void (async () => {
            await runAction("reset", "/api/exam-session/reset");
            setConfirmAction(null);
          })();
        }}
      />

      <ConfirmDialog
        open={confirmAction === "end"}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Akhiri Ujian"
        description="Yakin ingin mengakhiri ujian global sekarang?"
        confirmLabel="Akhiri Ujian"
        destructive
        loading={busyAction === "end"}
        onConfirm={() => {
          void (async () => {
            await runAction("end", "/api/exam-session/end");
            setConfirmAction(null);
          })();
        }}
      />
    </section>
  );
}
