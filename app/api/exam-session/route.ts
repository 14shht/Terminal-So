import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getGlobalExamControl, getRemainingSeconds } from "@/lib/exam-control";

export async function GET() {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (sessionUser.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const control = await getGlobalExamControl();
    const serverTime = new Date().toISOString();
    return NextResponse.json({
      examSession: {
        ...control,
        serverTime,
        remainingSeconds: getRemainingSeconds(control, serverTime),
      },
    });
  } catch (error) {
    console.error("[GET /api/exam-session] error:", error);
    return NextResponse.json({ error: "Gagal memuat kontrol ujian global." }, { status: 500 });
  }
}
