import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getExamSettings, listExamSessionMap } from "@/lib/exam-timer";

const MAX_USERNAME_LENGTH = 64;
const MAX_PASSWORD_LENGTH = 128;

const isValidRole = (value: unknown): value is "admin" | "student" => {
  return value === "admin" || value === "student";
};

const mapUser = (row: {
  id: string;
  username: string;
  role: "admin" | "student";
  created_at: string;
  question_pdf_url?: string | null;
}, timer?: {
  remainingSeconds: number;
  isPausedIndividual: boolean;
  endedAt: string | null;
  endedReason: string | null;
}) => ({
  id: row.id,
  username: row.username,
  role: row.role,
  created_at: row.created_at,
  questionPdfUrl: row.question_pdf_url ? `/api/questions/${row.id}/pdf` : null,
  timer: timer
    ? {
        remainingSeconds: timer.remainingSeconds,
        isPausedIndividual: timer.isPausedIndividual,
        endedAt: timer.endedAt,
        endedReason: timer.endedReason,
      }
    : null,
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const [sessionMap, settings] = await Promise.all([listExamSessionMap(), getExamSettings()]);
  const { data, error } = await supabase
    .from("users")
    .select("id, username, role, created_at, question_pdf_url")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /api/admin/users] supabase error:", error);
    return NextResponse.json({ error: "Gagal memuat user." }, { status: 500 });
  }

  return NextResponse.json({
    users: (data ?? []).map((row) => mapUser(row, sessionMap.get(row.id))),
    globalTimer: { isPaused: settings.isPaused, durationMinutes: settings.durationMinutes },
  });
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (sessionUser.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const username = body?.username?.toString?.().trim?.() ?? "";
  const password = body?.password?.toString?.() ?? "";
  const role = body?.role;

  if (!username || !password || !isValidRole(role)) {
    return NextResponse.json({ error: "username, password, dan role wajib diisi." }, { status: 400 });
  }
  if (username.length > MAX_USERNAME_LENGTH) {
    return NextResponse.json({ error: "Username terlalu panjang." }, { status: 400 });
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json({ error: "Password terlalu panjang." }, { status: 400 });
  }

  const passwordHash = hashPassword(password);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .insert({
      username,
      password_hash: passwordHash,
      role,
      question_pdf_url: null,
    })
    .select("id, username, role, created_at, question_pdf_url")
    .single();

  if (error) {
    console.error("[POST /api/admin/users] supabase error:", error);
    if (error.code === "23505") {
      return NextResponse.json({ error: "Username sudah dipakai." }, { status: 409 });
    }
    return NextResponse.json({ error: "Gagal menambah user." }, { status: 500 });
  }

  return NextResponse.json({ user: mapUser(data) });
}
