import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { startExamNow } from "@/lib/exam-control";

export async function PATCH() {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (sessionUser.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const examSession = await startExamNow(sessionUser.username);
    return NextResponse.json({ examSession });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memulai ujian.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}