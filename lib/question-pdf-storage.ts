import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_BUCKET = "question-pdfs";

export const PDF_MAX_SIZE_BYTES = MAX_PDF_SIZE_BYTES;

const getBucketName = () => process.env.SUPABASE_QUESTION_PDF_BUCKET || DEFAULT_BUCKET;

export const getPdfContentType = () => "application/pdf";

export const validatePdfFile = (file: File) => {
  if (!file) {
    return "Pilih file PDF terlebih dahulu.";
  }

  const fileName = (file.name || "").toLowerCase();
  const isPdf = file.type === "application/pdf" && fileName.endsWith(".pdf");

  if (!isPdf) {
    return "File harus berupa PDF.";
  }

  if (file.size > MAX_PDF_SIZE_BYTES) {
    return "Ukuran PDF maksimal 10MB.";
  }

  return null;
};

const sanitizeStudentId = (studentId: string) => studentId.replace(/[^a-zA-Z0-9_-]/g, "");

export const saveQuestionPdfToStorage = async (studentId: string, file: File) => {
  const bucket = getBucketName();
  const safeStudentId = sanitizeStudentId(studentId);
  const objectPath = `questions/${safeStudentId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.pdf`;

  const supabase = getSupabaseAdmin();
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage
    .from(bucket)
    .upload(objectPath, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return objectPath;
};

export const deleteQuestionPdfFromStorage = async (storedPath: string | null | undefined) => {
  if (!storedPath) {
    return;
  }
  const bucket = getBucketName();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(bucket).remove([storedPath]);
  if (error) {
    throw new Error(`Storage delete failed: ${error.message}`);
  }
};

export const readQuestionPdfFromStorage = async (storedPath: string) => {
  const bucket = getBucketName();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(bucket).download(storedPath);

  if (error || !data) {
    throw new Error(error?.message || "Storage download failed");
  }

  const bytes = Buffer.from(await data.arrayBuffer());
  return { content: bytes };
};
