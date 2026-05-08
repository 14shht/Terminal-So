import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getGlobalExamControl, getRemainingSeconds, getUserSubmittedState } from "@/lib/exam-control";

export async function GET() {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (sessionUser.role !== "student") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = getSupabaseAdmin();
    const { data: userRow, error } = await supabase
      .from("users")
      .select("id, username, role")
      .eq("username", sessionUser.username)
      .maybeSingle();

    if (error || !userRow) {
      return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
    }
    if (userRow.role !== "student") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const control = await getGlobalExamControl();
    const now = new Date().toISOString();
    const submitted = await getUserSubmittedState(userRow.id);
    const remainingSeconds = getRemainingSeconds(control, now);
    const status = submitted.isSubmitted
      ? "submitted"
      : control.status === "RUNNING"
        ? "active"
        : control.status === "ENDED"
          ? "timeout"
          : "paused";
    return NextResponse.json({
      session: {
        startedAt: control.startTime ?? now,
        durationMinutes: 90,
        expiresAt: control.endTime ?? now,
        remainingSeconds,
        endedAt: submitted.submittedAt,
        isPaused: control.status === "PAUSED",
        isPausedIndividual: false,
        now,
        status,
      },
    });
  } catch (error) {
    console.error("[GET /api/exam/session] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
