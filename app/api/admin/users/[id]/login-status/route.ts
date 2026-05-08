import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type Params = {
  params: Promise<{ id: string }>;
};

const mapUser = (row: {
  id: string;
  username: string;
  role: "admin" | "student";
  is_active: boolean;
  created_at: string;
  question_pdf_url?: string | null;
}) => ({
  id: row.id,
  username: row.username,
  role: row.role,
  isActive: row.is_active,
  created_at: row.created_at,
  questionPdfUrl: row.question_pdf_url ? `/api/questions/${row.id}/pdf` : null,
});

export async function PATCH(request: Request, context: Params) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (sessionUser.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const isActive = body?.isActive;
  if (typeof isActive !== "boolean") {
    return NextResponse.json({ error: "Field isActive wajib berupa boolean." }, { status: 400 });
  }

  const { id } = await context.params;
  const supabase = getSupabaseAdmin();

  const { data: targetUser, error: targetUserError } = await supabase
    .from("users")
    .select("id, username, role, is_active")
    .eq("id", id)
    .maybeSingle();

  if (targetUserError || !targetUser) {
    console.error("[PATCH /api/admin/users/[id]/login-status] query user error:", targetUserError);
    return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
  }

  if (targetUser.username === sessionUser.username && !isActive) {
    return NextResponse.json({ error: "Tidak bisa menonaktifkan akun sendiri." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("users")
    .update({ is_active: isActive })
    .eq("id", id)
    .select("id, username, role, is_active, created_at, question_pdf_url")
    .single();

  if (error) {
    console.error("[PATCH /api/admin/users/[id]/login-status] supabase error:", error);
    return NextResponse.json({ error: "Gagal mengubah status login akun." }, { status: 500 });
  }

  return NextResponse.json({ user: mapUser(data) });
}
