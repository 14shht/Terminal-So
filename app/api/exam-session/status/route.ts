import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getGlobalExamControl, getRemainingSeconds, getUserSubmittedState } from "@/lib/exam-control";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export async function GET() {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { data: userRow } = await supabase
      .from("users")
      .select("id, role, is_active")
      .eq("username", sessionUser.username)
      .maybeSingle();

    if (!userRow) {
      return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
    }

    const control = await getGlobalExamControl();
    const serverTime = new Date().toISOString();
    const remainingSeconds = getRemainingSeconds(control, serverTime);
    const { data: perUserSession } = await supabase
      .from("exam_sessions")
      .select("is_paused")
      .eq("user_id", userRow.id)
      .maybeSingle();
    const isPausedIndividual = Boolean(perUserSession?.is_paused);

    const submitted = userRow.role === "student" ? await getUserSubmittedState(userRow.id) : { isSubmitted: false, submittedAt: null };

    const isTerminalEnabled =
      userRow.role === "student" &&
      Boolean(userRow.is_active) &&
      !submitted.isSubmitted &&
      !isPausedIndividual &&
      control.status === "RUNNING";

    return NextResponse.json({
      status: control.status,
      startTime: control.startTime,
      endTime: control.endTime,
      serverTime,
      remainingSeconds,
      isTerminalEnabled,
      isPausedIndividual,
      isSubmitted: submitted.isSubmitted,
      submittedAt: submitted.submittedAt,
    });
  } catch (error) {
    console.error("[GET /api/exam-session/status] error:", error);
    return NextResponse.json({ error: "Gagal memuat status ujian." }, { status: 500 });
  }
}
