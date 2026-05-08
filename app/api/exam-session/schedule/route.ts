import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { scheduleGlobalExam } from "@/lib/exam-control";

export async function PATCH(request: Request) {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (sessionUser.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json().catch(() => null);
    const startTime = body?.startTime?.toString?.() ?? "";
    const endTime = body?.endTime?.toString?.() ?? "";
    if (!startTime || !endTime) {
      return NextResponse.json({ error: "startTime dan endTime wajib diisi." }, { status: 400 });
    }

    const examSession = await scheduleGlobalExam({
      startTime,
      endTime,
      updatedBy: sessionUser.username,
    });
    return NextResponse.json({ examSession });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menyimpan jadwal ujian.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}