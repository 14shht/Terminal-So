import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = body?.username?.toString?.().trim?.() ?? "";
  const password = body?.password?.toString?.() ?? "";

  if (!username || !password) {
    return NextResponse.json({ message: "Username dan password wajib diisi." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: user, error } = await supabase
    .from("users")
    .select("username, role, password_hash, is_active")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    console.error("[POST /api/login] supabase error:", error);
    return NextResponse.json({ message: "Gagal memproses login." }, { status: 500 });
  }

  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ message: "Username atau password salah." }, { status: 401 });
  }
  if (!user.is_active) {
    return NextResponse.json(
      { message: "Akun Anda sedang dinonaktifkan. Hubungi admin." },
      { status: 403 },
    );
  }

  const sessionUser = {
    username: user.username,
    role: user.role,
  } as const;

  await setSessionCookie(sessionUser);
  return NextResponse.json({ user: sessionUser });
}
