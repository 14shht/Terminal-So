import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (sessionUser.role !== "student") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);

    const studentName = body?.student_name || body?.studentName || body?.name;

    // Prevent client-side spoofing: always bind submission owner to active session user.
    const studentUsername = sessionUser.username;

    const fileName = body?.file_name || body?.fileName || body?.nameFile;

    const filePath = body?.file_path || body?.filePath || body?.path;

    const code = body?.code || body?.content || body?.fileContent;

    if (!studentName || !studentName.toString().trim()) {
      return NextResponse.json(
        {
          error: "Nama praktikan wajib diisi.",
        },
        { status: 400 },
      );
    }

    const normalizedName = studentName.toString().trim().slice(0, 120);
    const normalizedFileName = fileName?.toString?.().trim?.() ?? "";
    const normalizedFilePath = filePath?.toString?.().trim?.() ?? "";
    const normalizedCode = code?.toString?.() ?? "";

    if (!fileName || !filePath || !code) {
      return NextResponse.json(
        {
          error: "Data file submit tidak lengkap.",
          detail: {
            studentName: normalizedName,
            studentUsername,
            fileName: normalizedFileName,
            filePath: normalizedFilePath,
            code: normalizedCode ? "ada" : "kosong",
          },
        },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("submissions")
      .insert({
        user_id: null,
        student_name: normalizedName,
        student_username: studentUsername,
        file_name: normalizedFileName,
        file_path: normalizedFilePath,
        code: normalizedCode,
        // Backward compatibility for old schema where files_json is NOT NULL.
        files_json: [
          {
            name: normalizedFilePath,
            content: normalizedCode,
            type: "file",
            executable: false,
          },
        ],
      })
      .select()
      .single();

    if (error) {
      console.error("SUPABASE INSERT ERROR:", error);
      return NextResponse.json({ error: error.message, detail: error }, { status: 500 });
    }

    return NextResponse.json({ message: "Jawaban berhasil disubmit", data });
  } catch (error) {
    console.error("SERVER ERROR:", error);
    const message = error instanceof Error ? error.message : "Terjadi kesalahan server saat submit.";

    if (
      message.includes("NEXT_PUBLIC_SUPABASE_URL belum diisi") ||
      message.includes("SUPABASE_SERVICE_ROLE_KEY belum diisi")
    ) {
      return NextResponse.json({ error: "Missing Supabase environment variables" }, { status: 500 });
    }

    return NextResponse.json({ error: "Terjadi kesalahan server saat submit." }, { status: 500 });
  }
}

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from("submissions")
      .select("*")
      .order("submitted_at", { ascending: false });

    if (error) {
      console.error("SUPABASE SELECT ERROR:", error);
      return NextResponse.json({ error: error.message, detail: error }, { status: 500 });
    }

    return NextResponse.json({ submissions: data ?? [] });
  } catch (error) {
    console.error("SERVER ERROR GET SUBMISSIONS:", error);
    const message = error instanceof Error ? error.message : "Internal server error";

    if (
      message.includes("NEXT_PUBLIC_SUPABASE_URL belum diisi") ||
      message.includes("SUPABASE_SERVICE_ROLE_KEY belum diisi")
    ) {
      return NextResponse.json({ error: "Missing Supabase environment variables" }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
