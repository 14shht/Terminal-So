import { NextResponse } from "next/server";
import { randomUUID, createHash } from "crypto";
import { getSessionUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const HOME_DIR = "/home/student";

type Params = {
  params: Promise<{ submissionId: string }>;
};

const inferLanguage = (fileName: string, code: string): "c" | "bash" | null => {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".c")) return "c";
  if (lowerName.endsWith(".sh")) return "bash";

  const trimmed = code.trimStart();
  if (trimmed.startsWith("#!/bin/bash") || trimmed.startsWith("#!/usr/bin/env bash")) return "bash";
  if (/\bint\s+main\s*\(/.test(code) || /#include\s*<stdio\.h>/.test(code)) return "c";
  return null;
};

export async function POST(_: Request, { params }: Params) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { submissionId } = await params;
    if (!submissionId?.trim()) {
      return NextResponse.json({ error: "submission_id wajib diisi." }, { status: 400 });
    }

    const { data: submission, error } = await supabaseAdmin
      .from("submissions")
      .select("id, user_id, username, student_username, file_name, code, submitted_at")
      .eq("id", submissionId)
      .single();

    if (error || !submission) {
      return NextResponse.json({ error: "Submission tidak ditemukan." }, { status: 404 });
    }
    const submissionUsername =
      String((submission as { username?: string | null; student_username?: string | null }).username ?? "").trim() ||
      String((submission as { username?: string | null; student_username?: string | null }).student_username ?? "").trim();

    const latestCode = String(submission.code ?? "");
    if (!latestCode.trim()) {
      return NextResponse.json({ error: "Source code submission kosong." }, { status: 400 });
    }

    const language = inferLanguage(String(submission.file_name ?? ""), latestCode);
    if (!language) {
      return NextResponse.json({ error: "Language submission tidak dikenali. Gunakan file .c atau .sh." }, { status: 400 });
    }

    const runId = randomUUID();
    const workspacePath = HOME_DIR;
    const sourceFilename = language === "c" ? "main.c" : "main.sh";
    const sourcePath = `${workspacePath}/${sourceFilename}`;
    const compileCommand = language === "c" ? "rm -f program && gcc main.c -o program" : "chmod +x main.sh";
    const runCommand = language === "c" ? "./program" : "./main.sh";
    const codeHash = createHash("sha256").update(latestCode, "utf8").digest("hex");
    const previewLines = latestCode.split(/\r?\n/).slice(0, 10);
    const submissionUpdatedAt = submission.submitted_at ?? new Date().toISOString();

    return NextResponse.json({
      run: {
        run_id: runId,
        submission_id: submission.id,
        user_id: submission.user_id ?? "",
        username: submissionUsername,
        language,
        source_filename: sourceFilename,
        source_path: sourcePath,
        workspace_path: workspacePath,
        code_hash: codeHash,
        submission_updated_at: submissionUpdatedAt,
        compile_command: compileCommand,
        run_command: runCommand,
        preview_lines: previewLines,
      },
      terminalState: {
        currentDir: workspacePath,
        folders: [HOME_DIR],
        files: [
          {
            name: sourcePath,
            content: latestCode,
            type: "file",
            executable: language === "bash",
          },
        ],
        entries: [],
        submitted: false,
        layoutMode: "terminal",
        monitoredStudentId: submission.user_id ?? "",
        monitoredStudentUsername: submissionUsername,
      },
    });
  } catch (error) {
    console.error("[POST /api/admin/submissions/[submissionId]/load-terminal] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
