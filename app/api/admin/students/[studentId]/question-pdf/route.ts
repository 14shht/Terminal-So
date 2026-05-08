import { NextResponse } from "next/server";
import { extname } from "node:path";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  deleteQuestionPdfFromStorage,
  saveQuestionPdfToStorage,
  validatePdfFile,
} from "@/lib/question-pdf-storage";

type Params = {
  params: Promise<{ studentId: string }>;
};

export const runtime = "nodejs";

export async function GET(_: Request, context: Params) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (sessionUser.role !== "admin") {
    return NextResponse.json({ error: "Anda tidak memiliki akses." }, { status: 403 });
  }

  const { studentId } = await context.params;
  const supabase = getSupabaseAdmin();
  const { data: student, error } = await supabase
    .from("users")
    .select("id, role, question_pdf_url, username")
    .eq("id", studentId)
    .single();

  if (error || !student) {
    return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
  }
  if (student.role !== "student") {
    return NextResponse.json({ error: "User target bukan praktikan." }, { status: 400 });
  }

  return NextResponse.json({
    user: {
      id: student.id,
      username: student.username,
      questionPdfUrl: student.question_pdf_url ? `/api/questions/${student.id}/pdf` : null,
    },
  });
}

export async function POST(request: Request, context: Params) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (sessionUser.role !== "admin") {
    return NextResponse.json({ error: "Anda tidak memiliki akses." }, { status: 403 });
  }

  const { studentId } = await context.params;
  const supabase = getSupabaseAdmin();

  const { data: student, error: studentError } = await supabase
    .from("users")
    .select("id, role, question_pdf_url")
    .eq("id", studentId)
    .single();

  if (studentError || !student) {
    return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
  }
  if (student.role !== "student") {
    return NextResponse.json({ error: "Soal hanya bisa diupload untuk praktikan." }, { status: 400 });
  }

  const formData = await request.formData();
  const fileField = formData.get("file");

  if (!(fileField instanceof File)) {
    return NextResponse.json({ error: "Pilih file PDF terlebih dahulu." }, { status: 400 });
  }

  const fileError = validatePdfFile(fileField);
  if (fileError) {
    return NextResponse.json({ error: fileError }, { status: 400 });
  }

  if (extname(fileField.name).toLowerCase() !== ".pdf") {
    return NextResponse.json({ error: "File harus berupa PDF." }, { status: 400 });
  }

  const previousStoredPath = student.question_pdf_url || null;
  let nextStoredPath = "";
  try {
    nextStoredPath = await saveQuestionPdfToStorage(studentId, fileField);
  } catch (error) {
    console.error("[POST /api/admin/students/[studentId]/question-pdf] storage upload error:", error);
    const message = error instanceof Error ? error.message : "Gagal mengupload soal PDF.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("users")
    .update({ question_pdf_url: nextStoredPath })
    .eq("id", studentId);

  if (updateError) {
    console.error("[POST /api/admin/students/[studentId]/question-pdf] update error:", updateError);
    return NextResponse.json({ error: "Gagal mengupload soal PDF." }, { status: 500 });
  }

  await deleteQuestionPdfFromStorage(previousStoredPath).catch((err) => {
    console.warn("Failed to delete previous PDF file:", err);
  });

  return NextResponse.json({
    message: "Soal PDF berhasil diupload.",
    user: {
      id: studentId,
      questionPdfUrl: `/api/questions/${studentId}/pdf`,
    },
  });
}
