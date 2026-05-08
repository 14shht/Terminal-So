import { getSupabaseAdmin } from "@/lib/supabase-server";

export const DEFAULT_EXAM_DURATION_MINUTES = 90;
export const MIN_EXAM_DURATION_MINUTES = 15;
export const MAX_EXAM_DURATION_MINUTES = 300;

export type ExamSessionStatus = "active" | "submitted" | "timeout";

export type ExamSessionInfo = {
  userId: string;
  startedAt: string;
  durationMinutes: number;
  expiresAt: string;
  remainingSeconds: number;
  endedAt: string | null;
  isPaused: boolean;
  isPausedIndividual: boolean;
  now: string;
  status: ExamSessionStatus;
};

type ExamSessionRow = {
  user_id: string;
  started_at: string;
  duration_minutes: number;
  remaining_seconds: number | null;
  is_paused: boolean | null;
  ended_at: string | null;
  ended_reason: string | null;
  updated_at: string | null;
};

const getSettingsRow = async () => {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("exam_settings")
    .select("duration_minutes, is_paused, paused_at")
    .eq("id", true)
    .maybeSingle();

  return data ?? null;
};

const normalizeDuration = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_EXAM_DURATION_MINUTES;
  }
  return Math.min(MAX_EXAM_DURATION_MINUTES, Math.max(MIN_EXAM_DURATION_MINUTES, Math.floor(value)));
};

export const getOrCreateExamSession = async (params: {
  userId: string;
  username: string;
}): Promise<ExamSessionInfo> => {
  const { userId } = params;
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const settings = await getSettingsRow();
  const isPausedByAdmin = Boolean(settings?.is_paused);
  const nowIso = now.toISOString();

  const { data: existing } = await supabase
    .from("exam_sessions")
    .select(
      "user_id, started_at, duration_minutes, remaining_seconds, is_paused, ended_at, ended_reason, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  const hasSubmitted = Boolean(existing?.ended_at) && existing?.ended_reason === "submitted";
  const durationMinutes = normalizeDuration(existing?.duration_minutes ?? settings?.duration_minutes);
  const startedAt = existing?.started_at ?? now.toISOString();
  const isIndividuallyPaused = Boolean(existing?.is_paused);
  const effectivePaused = isPausedByAdmin || isIndividuallyPaused;
  const initialRemaining = Math.max(0, durationMinutes * 60);
  const storedRemaining = typeof existing?.remaining_seconds === "number" ? Math.max(0, existing.remaining_seconds) : null;
  const lastSyncMs = existing?.updated_at ? new Date(existing.updated_at).getTime() : new Date(startedAt).getTime();
  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - lastSyncMs) / 1000));
  const baseRemaining = storedRemaining ?? initialRemaining;
  const remainingSeconds = effectivePaused ? baseRemaining : Math.max(0, baseRemaining - elapsedSeconds);
  const isTimedOut = remainingSeconds <= 0 && !isPausedByAdmin;
  const expiresAtDate = new Date(now.getTime() + remainingSeconds * 1000);

  if (!existing) {
    await supabase.from("exam_sessions").insert({
      user_id: userId,
      started_at: startedAt,
      duration_minutes: durationMinutes,
      remaining_seconds: initialRemaining,
      is_paused: false,
      ended_at: isTimedOut ? now.toISOString() : null,
      ended_reason: isTimedOut ? "timeout" : null,
      updated_at: nowIso,
    });
  } else if (!existing.ended_at) {
    const patch: Record<string, unknown> = {
      duration_minutes: durationMinutes,
      remaining_seconds: remainingSeconds,
      updated_at: nowIso,
    };
    if (isTimedOut) {
      patch.ended_at = nowIso;
      patch.ended_reason = "timeout";
    }
    await supabase
      .from("exam_sessions")
      .update(patch)
      .eq("user_id", userId);
  }

  const status: ExamSessionStatus = hasSubmitted
    ? "submitted"
    : isTimedOut
      ? "timeout"
      : "active";

  return {
    userId,
    startedAt,
    durationMinutes,
    expiresAt: expiresAtDate.toISOString(),
    remainingSeconds,
    endedAt: existing?.ended_at ?? (hasSubmitted || isTimedOut ? nowIso : null),
    isPaused: isPausedByAdmin,
    isPausedIndividual: isIndividuallyPaused,
    now: now.toISOString(),
    status,
  };
};

export const markExamSubmitted = async (userId: string) => {
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const { data: existing } = await supabase
    .from("exam_sessions")
    .select("started_at, duration_minutes, remaining_seconds")
    .eq("user_id", userId)
    .maybeSingle();
  await supabase
    .from("exam_sessions")
    .upsert(
      {
        user_id: userId,
        started_at: existing?.started_at ?? nowIso,
        duration_minutes: existing?.duration_minutes ?? DEFAULT_EXAM_DURATION_MINUTES,
        remaining_seconds:
          typeof existing?.remaining_seconds === "number"
            ? Math.max(0, existing.remaining_seconds)
            : DEFAULT_EXAM_DURATION_MINUTES * 60,
        is_paused: false,
        ended_at: nowIso,
        ended_reason: "submitted",
        updated_at: nowIso,
      },
      { onConflict: "user_id" },
    );
};

export const getExamSettings = async () => {
  const row = await getSettingsRow();
  return {
    durationMinutes: normalizeDuration(row?.duration_minutes),
    isPaused: Boolean(row?.is_paused),
  };
};

export const updateExamSettings = async (durationMinutes: number) => {
  const normalized = Math.min(
    MAX_EXAM_DURATION_MINUTES,
    Math.max(MIN_EXAM_DURATION_MINUTES, Math.floor(durationMinutes)),
  );
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("exam_settings")
    .upsert(
      {
        id: true,
        duration_minutes: normalized,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("duration_minutes, is_paused")
    .single();

  if (error) {
    throw error;
  }

  return {
    durationMinutes: normalizeDuration(data.duration_minutes),
    isPaused: Boolean(data.is_paused),
  };
};

export const setExamPause = async (nextPaused: boolean) => {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();

  if (nextPaused) {
    await supabase
      .from("exam_settings")
      .upsert(
        { id: true, is_paused: true, paused_at: nowIso, updated_at: nowIso },
        { onConflict: "id" },
      );
    return { isPaused: true };
  }

  await supabase
    .from("exam_settings")
    .upsert(
      { id: true, is_paused: false, paused_at: null, updated_at: nowIso },
      { onConflict: "id" },
    );

  return { isPaused: false };
};

export const addGlobalExamTime = async (minutesToAdd: number) => {
  const secondsToAdd = Math.max(0, Math.floor(minutesToAdd * 60));
  if (secondsToAdd <= 0) return;
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("exam_sessions")
    .select("user_id, remaining_seconds, ended_at")
    .is("ended_at", null);

  for (const row of data ?? []) {
    const current = typeof row.remaining_seconds === "number" ? Math.max(0, row.remaining_seconds) : 0;
    await supabase
      .from("exam_sessions")
      .update({
        remaining_seconds: current + secondsToAdd,
        updated_at: nowIso,
      })
      .eq("user_id", row.user_id);
  }
};

export const resetGlobalExamTimer = async () => {
  const settings = await getExamSettings();
  const nextSeconds = Math.max(0, Math.floor(settings.durationMinutes * 60));
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  await supabase
    .from("exam_sessions")
    .update({
      duration_minutes: settings.durationMinutes,
      remaining_seconds: nextSeconds,
      ended_at: null,
      ended_reason: null,
      updated_at: nowIso,
    })
    .is("ended_at", null);
};

export const addStudentExamTime = async (userId: string, minutesToAdd: number) => {
  const secondsToAdd = Math.max(0, Math.floor(minutesToAdd * 60));
  if (secondsToAdd <= 0) return;
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();
  const settings = await getExamSettings();
  const settingsRow = await getSettingsRow();
  const { data } = await supabase
    .from("exam_sessions")
    .select("started_at, duration_minutes, remaining_seconds, is_paused, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) {
    const durationMinutes = normalizeDuration(data.duration_minutes ?? settings.durationMinutes);
    const fallbackRemaining = Math.max(0, durationMinutes * 60);
    const storedRemaining =
      typeof data.remaining_seconds === "number" ? Math.max(0, data.remaining_seconds) : fallbackRemaining;
    const referenceMs = data.updated_at
      ? new Date(data.updated_at).getTime()
      : data.started_at
        ? new Date(data.started_at).getTime()
        : now.getTime();
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - referenceMs) / 1000));
    const effectivePaused = Boolean(settingsRow?.is_paused) || Boolean(data.is_paused);
    const currentRemaining = effectivePaused
      ? storedRemaining
      : Math.max(0, storedRemaining - elapsedSeconds);

    await supabase
      .from("exam_sessions")
      .update({
        remaining_seconds: currentRemaining + secondsToAdd,
        ended_at: null,
        ended_reason: null,
        updated_at: nowIso,
      })
      .eq("user_id", userId);
    return;
  }

  await supabase.from("exam_sessions").insert({
    user_id: userId,
    started_at: nowIso,
    duration_minutes: settings.durationMinutes,
    remaining_seconds: settings.durationMinutes * 60 + secondsToAdd,
    is_paused: false,
    ended_at: null,
    ended_reason: null,
    updated_at: nowIso,
  });
};

export const setStudentExamPause = async (userId: string, paused: boolean) => {
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const settings = await getExamSettings();
  const { data: existing } = await supabase
    .from("exam_sessions")
    .select("user_id, started_at, duration_minutes, remaining_seconds, ended_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing && !existing.ended_at) {
    await supabase
      .from("exam_sessions")
      .update({ is_paused: paused, updated_at: nowIso })
      .eq("user_id", userId)
      .is("ended_at", null);
    return;
  }

  await supabase
    .from("exam_sessions")
    .upsert(
      {
        user_id: userId,
        started_at: existing?.started_at ?? nowIso,
        duration_minutes: existing?.duration_minutes ?? settings.durationMinutes,
        remaining_seconds:
          typeof existing?.remaining_seconds === "number"
            ? Math.max(0, existing.remaining_seconds)
            : settings.durationMinutes * 60,
        is_paused: paused,
        ended_at: null,
        ended_reason: null,
        updated_at: nowIso,
      },
      { onConflict: "user_id" },
    );
};

export const resetStudentExamTimer = async (userId: string) => {
  const settings = await getExamSettings();
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  await supabase
    .from("exam_sessions")
    .upsert(
      {
        user_id: userId,
        started_at: nowIso,
        duration_minutes: settings.durationMinutes,
        remaining_seconds: settings.durationMinutes * 60,
        is_paused: false,
        ended_at: null,
        ended_reason: null,
        updated_at: nowIso,
      },
      { onConflict: "user_id" },
    );
};

export const forceFinishStudentExam = async (userId: string) => {
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const settings = await getExamSettings();
  const { data: existing } = await supabase
    .from("exam_sessions")
    .select("started_at, duration_minutes")
    .eq("user_id", userId)
    .maybeSingle();

  await supabase
    .from("exam_sessions")
    .upsert(
      {
        user_id: userId,
        started_at: existing?.started_at ?? nowIso,
        duration_minutes: existing?.duration_minutes ?? settings.durationMinutes,
        remaining_seconds: 0,
        is_paused: false,
        ended_at: nowIso,
        ended_reason: "submitted",
        updated_at: nowIso,
      },
      { onConflict: "user_id" },
    );
};

export const reopenStudentExam = async (userId: string) => {
  await resetStudentExamTimer(userId);
};

export const listExamSessionMap = async () => {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("exam_sessions")
    .select("user_id, remaining_seconds, is_paused, ended_at, ended_reason, updated_at");
  const result = new Map<
    string,
    {
      remainingSeconds: number;
      isPausedIndividual: boolean;
      endedAt: string | null;
      endedReason: string | null;
      updatedAt: string | null;
    }
  >();
  for (const row of (data ?? []) as ExamSessionRow[]) {
    result.set(row.user_id, {
      remainingSeconds: Math.max(0, row.remaining_seconds ?? 0),
      isPausedIndividual: Boolean(row.is_paused),
      endedAt: row.ended_at,
      endedReason: row.ended_reason,
      updatedAt: row.updated_at,
    });
  }
  return result;
};
