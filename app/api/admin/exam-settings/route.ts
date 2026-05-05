import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  MAX_EXAM_DURATION_MINUTES,
  MIN_EXAM_DURATION_MINUTES,
  addGlobalExamTime,
  getExamSettings,
  resetGlobalExamTimer,
  setExamPause,
  updateExamSettings,
} from "@/lib/exam-timer";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const settings = await getExamSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("[GET /api/admin/exam-settings] error:", error);
    return NextResponse.json({ error: "Gagal memuat pengaturan timer." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (body?.action === "toggle_pause") {
      const nextPaused = Boolean(body?.nextPaused);
      const pauseState = await setExamPause(nextPaused);
      const settings = await getExamSettings();
      return NextResponse.json({ settings: { ...settings, isPaused: pauseState.isPaused } });
    }
    if (body?.action === "add_global_time") {
      const minutes = Number(body?.minutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return NextResponse.json({ error: "Menit tambahan tidak valid." }, { status: 400 });
      }
      await addGlobalExamTime(minutes);
      const settings = await getExamSettings();
      return NextResponse.json({ settings });
    }
    if (body?.action === "reset_global_timer") {
      await resetGlobalExamTimer();
      const settings = await getExamSettings();
      return NextResponse.json({ settings });
    }

    const rawDuration = Number(body?.durationMinutes);
    if (!Number.isFinite(rawDuration)) {
      return NextResponse.json({ error: "Durasi timer tidak valid." }, { status: 400 });
    }

    if (rawDuration < MIN_EXAM_DURATION_MINUTES || rawDuration > MAX_EXAM_DURATION_MINUTES) {
      return NextResponse.json(
        {
          error: `Durasi harus di antara ${MIN_EXAM_DURATION_MINUTES}-${MAX_EXAM_DURATION_MINUTES} menit.`,
        },
        { status: 400 },
      );
    }

    const settings = await updateExamSettings(rawDuration);
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("[PATCH /api/admin/exam-settings] error:", error);
    return NextResponse.json({ error: "Gagal menyimpan pengaturan timer." }, { status: 500 });
  }
}
