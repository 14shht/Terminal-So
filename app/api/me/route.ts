import { NextResponse } from "next/server";
import { clearSessionCookie, getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export async function GET() {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("users")
      .select("id, username, role, is_active, question_pdf_url")
      .eq("username", sessionUser.username)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/me] supabase error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!data.is_active) {
      await clearSessionCookie();
      return NextResponse.json({ error: "Akun Anda sedang dinonaktifkan. Hubungi admin." }, { status: 403 });
    }

    return NextResponse.json({
      user: {
        id: data.id,
        username: data.username,
        role: data.role,
        isActive: data.is_active,
        questionPdfUrl: data.question_pdf_url ? `/api/questions/${data.id}/pdf` : null,
      },
    });
  } catch (error) {
    console.error("[GET /api/me] unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
