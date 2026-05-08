import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type Params = {
  params: Promise<{ id: string }>;
};

const isValidRole = (value: unknown): value is "admin" | "student" => {
  return value === "admin" || value === "student";
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

  const { id } = await context.params;
  const supabase = getSupabaseAdmin();

  const { data: targetUser, error: targetUserError } = await supabase
    .from("users")
    .select("id, username, role")
    .eq("id", id)
    .single();

  if (targetUserError || !targetUser) {
    console.error("[PATCH /api/admin/users/[id]] query user error:", targetUserError);
    return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);

  const nextRole = body?.role;
  const nextPassword = body?.password?.toString?.() ?? "";

  const updates: Record<string, string> = {};
  if (isValidRole(nextRole)) {
    if (targetUser.role === "admin" && nextRole === "student") {
      return NextResponse.json({ error: "Role admin tidak boleh diubah ke student." }, { status: 400 });
    }
    updates.role = nextRole;
  }
  if (nextPassword) {
    updates.password_hash = hashPassword(nextPassword);
  }

  if (!updates.role && !updates.password_hash) {
    return NextResponse.json({ error: "Tidak ada perubahan data." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", id)
    .select("id, username, role, is_active, created_at, question_pdf_url")
    .single();

  if (error) {
    console.error("[PATCH /api/admin/users/[id]] supabase error:", error);
    return NextResponse.json({ error: "Gagal update user." }, { status: 500 });
  }

  return NextResponse.json({ user: mapUser(data) });
}

export async function DELETE(_: Request, context: Params) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (sessionUser.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const supabase = getSupabaseAdmin();

  const { data: targetUser, error: targetUserError } = await supabase
    .from("users")
    .select("id, username, role")
    .eq("id", id)
    .single();

  if (targetUserError) {
    console.error("[DELETE /api/admin/users/[id]] query user error:", targetUserError);
    return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
  }

  if (targetUser.username === sessionUser.username) {
    return NextResponse.json({ error: "Admin tidak dapat menghapus akun sendiri." }, { status: 400 });
  }

  if (targetUser.role === "admin") {
    return NextResponse.json({ error: "Akun dengan role admin tidak boleh dihapus." }, { status: 400 });
  }

  const { error } = await supabase.from("users").delete().eq("id", id);
  if (error) {
    console.error("[DELETE /api/admin/users/[id]] supabase error:", error);
    return NextResponse.json({ error: "Gagal hapus user." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
