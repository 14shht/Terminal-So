import { getSupabaseAdmin } from "@/lib/supabase-server";

export type GlobalExamStatus = "NOT_STARTED" | "SCHEDULED" | "RUNNING" | "PAUSED" | "ENDED";

export type GlobalExamControlRow = {
  id: boolean;
  status: GlobalExamStatus;
  start_time: string | null;
  end_time: string | null;
  paused_at: string | null;
  paused_remaining_seconds: number | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type GlobalExamControl = {
  status: GlobalExamStatus;
  startTime: string | null;
  endTime: string | null;
  pausedAt: string | null;
  pausedRemainingSeconds: number | null;
  updatedAt: string;
};

const DEFAULT_DURATION_MINUTES = 90;

const toControl = (row: GlobalExamControlRow): GlobalExamControl => ({
  status: row.status,
  startTime: row.start_time,
  endTime: row.end_time,
  pausedAt: row.paused_at,
  pausedRemainingSeconds: row.paused_remaining_seconds,
  updatedAt: row.updated_at,
});

const getOrCreateControlRow = async (): Promise<GlobalExamControlRow> => {
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from("exam_control")
    .select("id, status, start_time, end_time, paused_at, paused_remaining_seconds, updated_by, created_at, updated_at")
    .eq("id", true)
    .maybeSingle();

  if (existing) {
    return existing as GlobalExamControlRow;
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("exam_control")
    .insert({
      id: true,
      status: "NOT_STARTED",
      start_time: null,
      end_time: null,
      paused_at: null,
      paused_remaining_seconds: null,
      updated_by: null,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id, status, start_time, end_time, paused_at, paused_remaining_seconds, updated_by, created_at, updated_at")
    .single();

  if (error || !data) {
    throw error ?? new Error("Gagal membuat exam control awal.");
  }
  return data as GlobalExamControlRow;
};

export const syncGlobalExamStatus = async (row: GlobalExamControlRow): Promise<GlobalExamControlRow> => {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  if (row.status === "SCHEDULED" && row.start_time) {
    const startMs = new Date(row.start_time).getTime();
    if (now >= startMs) {
      const patch: Partial<GlobalExamControlRow> = {
        status: "RUNNING",
        updated_at: nowIso,
      };
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("exam_control")
        .update(patch)
        .eq("id", true)
        .select("id, status, start_time, end_time, paused_at, paused_remaining_seconds, updated_by, created_at, updated_at")
        .single();
      if (error || !data) {
        throw error ?? new Error("Gagal sinkronisasi status ujian.");
      }
      row = data as GlobalExamControlRow;
    }
  }

  if (row.status === "RUNNING" && row.end_time) {
    const endMs = new Date(row.end_time).getTime();
    if (now >= endMs) {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("exam_control")
        .update({
          status: "ENDED",
          end_time: nowIso,
          paused_at: null,
          paused_remaining_seconds: 0,
          updated_at: nowIso,
        })
        .eq("id", true)
        .select("id, status, start_time, end_time, paused_at, paused_remaining_seconds, updated_by, created_at, updated_at")
        .single();
      if (error || !data) {
        throw error ?? new Error("Gagal menyelesaikan ujian otomatis.");
      }
      row = data as GlobalExamControlRow;
    }
  }

  return row;
};

export const getGlobalExamControl = async (): Promise<GlobalExamControl> => {
  const row = await syncGlobalExamStatus(await getOrCreateControlRow());
  return toControl(row);
};

export const getRemainingSeconds = (control: GlobalExamControl, serverTimeIso: string): number => {
  const nowMs = new Date(serverTimeIso).getTime();
  if (control.status === "RUNNING" && control.endTime) {
    return Math.max(0, Math.floor((new Date(control.endTime).getTime() - nowMs) / 1000));
  }
  if (control.status === "SCHEDULED" && control.startTime) {
    return Math.max(0, Math.floor((new Date(control.startTime).getTime() - nowMs) / 1000));
  }
  if (control.status === "PAUSED") {
    return Math.max(0, control.pausedRemainingSeconds ?? 0);
  }
  return 0;
};

export const scheduleGlobalExam = async (params: {
  startTime: string;
  endTime: string;
  updatedBy: string;
}): Promise<GlobalExamControl> => {
  const startMs = new Date(params.startTime).getTime();
  const endMs = new Date(params.endTime).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("Waktu selesai harus lebih besar dari waktu mulai.");
  }

  const nowIso = new Date().toISOString();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("exam_control")
    .upsert(
      {
        id: true,
        status: "SCHEDULED",
        start_time: new Date(startMs).toISOString(),
        end_time: new Date(endMs).toISOString(),
        paused_at: null,
        paused_remaining_seconds: null,
        updated_by: params.updatedBy,
        updated_at: nowIso,
      },
      { onConflict: "id" },
    )
    .select("id, status, start_time, end_time, paused_at, paused_remaining_seconds, updated_by, created_at, updated_at")
    .single();

  if (error || !data) {
    throw error ?? new Error("Gagal menyimpan jadwal ujian.");
  }
  return toControl(data as GlobalExamControlRow);
};

export const startExamNow = async (updatedBy: string): Promise<GlobalExamControl> => {
  const current = await getGlobalExamControl();
  if (current.status === "RUNNING") {
    throw new Error("Ujian sudah berjalan.");
  }
  if (current.status === "PAUSED") {
    throw new Error("Ujian sedang dipause. Gunakan lanjutkan ujian.");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const currentStartMs = current.startTime ? new Date(current.startTime).getTime() : NaN;
  const currentEndMs = current.endTime ? new Date(current.endTime).getTime() : NaN;
  const hasValidSchedule = Number.isFinite(currentStartMs) && Number.isFinite(currentEndMs) && currentEndMs > currentStartMs;
  const durationSeconds = hasValidSchedule
    ? Math.max(1, Math.floor((currentEndMs - currentStartMs) / 1000))
    : DEFAULT_DURATION_MINUTES * 60;
  const nextEndIso = new Date(now.getTime() + durationSeconds * 1000).toISOString();

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("exam_control")
    .upsert(
      {
        id: true,
        status: "RUNNING",
        start_time: nowIso,
        end_time: nextEndIso,
        paused_at: null,
        paused_remaining_seconds: null,
        updated_by: updatedBy,
        updated_at: nowIso,
      },
      { onConflict: "id" },
    )
    .select("id, status, start_time, end_time, paused_at, paused_remaining_seconds, updated_by, created_at, updated_at")
    .single();

  if (error || !data) {
    throw error ?? new Error("Gagal memulai ujian.");
  }
  return toControl(data as GlobalExamControlRow);
};

export const pauseExam = async (updatedBy: string): Promise<GlobalExamControl> => {
  const current = await getGlobalExamControl();
  if (current.status !== "RUNNING") {
    throw new Error("Ujian hanya bisa dipause saat status RUNNING.");
  }
  if (!current.endTime) {
    throw new Error("Waktu selesai ujian tidak valid.");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const remainingSeconds = Math.max(0, Math.floor((new Date(current.endTime).getTime() - now.getTime()) / 1000));

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("exam_control")
    .update({
      status: "PAUSED",
      paused_at: nowIso,
      paused_remaining_seconds: remainingSeconds,
      updated_by: updatedBy,
      updated_at: nowIso,
    })
    .eq("id", true)
    .select("id, status, start_time, end_time, paused_at, paused_remaining_seconds, updated_by, created_at, updated_at")
    .single();

  if (error || !data) {
    throw error ?? new Error("Gagal pause ujian.");
  }
  return toControl(data as GlobalExamControlRow);
};

export const resumeExam = async (updatedBy: string): Promise<GlobalExamControl> => {
  const current = await getGlobalExamControl();
  if (current.status !== "PAUSED") {
    throw new Error("Ujian hanya bisa dilanjutkan dari status PAUSED.");
  }

  const remain = Math.max(1, current.pausedRemainingSeconds ?? 0);
  const now = new Date();
  const nowIso = now.toISOString();
  const nextEndIso = new Date(now.getTime() + remain * 1000).toISOString();

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("exam_control")
    .update({
      status: "RUNNING",
      start_time: nowIso,
      end_time: nextEndIso,
      paused_at: null,
      paused_remaining_seconds: null,
      updated_by: updatedBy,
      updated_at: nowIso,
    })
    .eq("id", true)
    .select("id, status, start_time, end_time, paused_at, paused_remaining_seconds, updated_by, created_at, updated_at")
    .single();

  if (error || !data) {
    throw error ?? new Error("Gagal melanjutkan ujian.");
  }
  return toControl(data as GlobalExamControlRow);
};

export const resetExam = async (updatedBy: string): Promise<GlobalExamControl> => {
  const nowIso = new Date().toISOString();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("exam_control")
    .update({
      status: "NOT_STARTED",
      start_time: null,
      end_time: null,
      paused_at: null,
      paused_remaining_seconds: null,
      updated_by: updatedBy,
      updated_at: nowIso,
    })
    .eq("id", true)
    .select("id, status, start_time, end_time, paused_at, paused_remaining_seconds, updated_by, created_at, updated_at")
    .single();

  if (error || !data) {
    throw error ?? new Error("Gagal reset ujian.");
  }
  return toControl(data as GlobalExamControlRow);
};

export const endExam = async (updatedBy: string): Promise<GlobalExamControl> => {
  const current = await getGlobalExamControl();
  if (current.status === "ENDED") {
    throw new Error("Ujian sudah selesai.");
  }
  const nowIso = new Date().toISOString();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("exam_control")
    .update({
      status: "ENDED",
      end_time: nowIso,
      paused_at: null,
      paused_remaining_seconds: 0,
      updated_by: updatedBy,
      updated_at: nowIso,
    })
    .eq("id", true)
    .select("id, status, start_time, end_time, paused_at, paused_remaining_seconds, updated_by, created_at, updated_at")
    .single();

  if (error || !data) {
    throw error ?? new Error("Gagal mengakhiri ujian.");
  }
  return toControl(data as GlobalExamControlRow);
};

export const getUserSubmittedState = async (userId: string) => {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("exam_sessions")
    .select("ended_at, ended_reason")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    isSubmitted: Boolean(data?.ended_at) && data?.ended_reason === "submitted",
    submittedAt: data?.ended_at ?? null,
  };
};

export const markExamSubmitted = async (userId: string) => {
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  await supabase
    .from("exam_sessions")
    .upsert(
      {
        user_id: userId,
        started_at: nowIso,
        duration_minutes: DEFAULT_DURATION_MINUTES,
        remaining_seconds: 0,
        is_paused: false,
        ended_at: nowIso,
        ended_reason: "submitted",
        updated_at: nowIso,
      },
      { onConflict: "user_id" },
    );
};
