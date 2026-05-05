import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getPdfContentType, readQuestionPdfFromStorage } from "@/lib/question-pdf-storage";

type Params = {
  params: Promise<{ studentId: string }>;
};

export const runtime = "nodejs";

export async function GET(_: Request, context: Params) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { studentId } = await context.params;
  const supabase = getSupabaseAdmin();

  const { data: requester, error: requesterError } = await supabase
    .from("users")
    .select("id, role, username")
    .eq("username", sessionUser.username)
    .maybeSingle();

  if (requesterError || !requester) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (requester.role !== "admin" && requester.id !== studentId) {
    return NextResponse.json({ error: "Anda tidak memiliki akses." }, { status: 403 });
  }

  const { data: target, error: targetError } = await supabase
    .from("users")
    .select("id, question_pdf_url")
    .eq("id", studentId)
    .single();

  if (targetError || !target) {
    return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
  }

  if (!target.question_pdf_url) {
    return NextResponse.json({ error: "Soal PDF belum tersedia. Silakan hubungi admin." }, { status: 404 });
  }

  try {
    const { content } = await readQuestionPdfFromStorage(target.question_pdf_url);
    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": getPdfContentType(),
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="soal-${studentId}.pdf"`,
      },
    });
  } catch (error) {
    console.error("[GET /api/questions/[studentId]/pdf] read error:", error);
    return NextResponse.json({ error: "Soal PDF belum tersedia. Silakan hubungi admin." }, { status: 404 });
  }
}
