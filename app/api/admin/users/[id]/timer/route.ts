import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  addStudentExamTime,
  forceFinishStudentExam,
  reopenStudentExam,
  resetStudentExamTimer,
  setStudentExamPause,
} from "@/lib/exam-timer";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: Params) {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (sessionUser.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const action = String(body?.action || "");

    const supabase = getSupabaseAdmin();
    const { data: targetUser } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", id)
      .maybeSingle();

    if (!targetUser) {
      return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
    }
    if (targetUser.role !== "student") {
      return NextResponse.json({ error: "Timer hanya bisa diatur untuk student." }, { status: 400 });
    }

    if (action === "add_time") {
      const minutes = Number(body?.minutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return NextResponse.json({ error: "Menit tambahan tidak valid." }, { status: 400 });
      }
      await addStudentExamTime(id, minutes);
      return NextResponse.json({ success: true });
    }

    if (action === "toggle_pause") {
      await setStudentExamPause(id, Boolean(body?.nextPaused));
      return NextResponse.json({ success: true });
    }

    if (action === "reset_timer") {
      await resetStudentExamTimer(id);
      return NextResponse.json({ success: true });
    }

    if (action === "force_finish") {
      await forceFinishStudentExam(id);
      return NextResponse.json({ success: true });
    }

    if (action === "reopen_exam") {
      await reopenStudentExam(id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Action tidak dikenal." }, { status: 400 });
  } catch (error) {
    console.error("[PATCH /api/admin/users/[id]/timer] error:", error);
    return NextResponse.json({ error: "Gagal mengubah timer student." }, { status: 500 });
  }
}
