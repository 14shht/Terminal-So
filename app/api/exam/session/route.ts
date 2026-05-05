import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getOrCreateExamSession } from "@/lib/exam-timer";

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

    const session = await getOrCreateExamSession({ userId: userRow.id, username: userRow.username });
    return NextResponse.json({ session });
  } catch (error) {
    console.error("[GET /api/exam/session] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
