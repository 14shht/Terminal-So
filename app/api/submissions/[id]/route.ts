import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await context.params;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("submissions").select("*").eq("id", id).single();

    if (error) {
      console.error("[GET /api/submissions/[id]] supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const submissionUserId = data?.user_id?.toString?.() ?? "";
    const submissionUsername =
      data?.username?.toString?.() ??
      data?.student_username?.toString?.() ??
      "";
    let assignedQuestion: {
      id: string;
      title: string;
      fileName: string;
      fileUrl: string;
      assignedAt: string | null;
    } | null = null;

    if (submissionUserId) {
      const { data: questionOwner } = await supabase
        .from("users")
        .select("id, username, question_pdf_url, created_at")
        .eq("id", submissionUserId)
        .maybeSingle();

      if (questionOwner?.question_pdf_url) {
        const fileName = questionOwner.question_pdf_url.split("/").pop() || "soal.pdf";
        assignedQuestion = {
          id: questionOwner.id,
          title: `Soal ${questionOwner.username}`,
          fileName,
          fileUrl: `/api/questions/${questionOwner.id}/pdf`,
          assignedAt: questionOwner.created_at ?? null,
        };
      }
    }

    if (!assignedQuestion && submissionUsername) {
      const { data: questionOwner } = await supabase
        .from("users")
        .select("id, username, question_pdf_url, created_at")
        .eq("username", submissionUsername)
        .maybeSingle();

      if (questionOwner?.question_pdf_url) {
        const fileName = questionOwner.question_pdf_url.split("/").pop() || "soal.pdf";
        assignedQuestion = {
          id: questionOwner.id,
          title: `Soal ${questionOwner.username}`,
          fileName,
          fileUrl: `/api/questions/${questionOwner.id}/pdf`,
          assignedAt: questionOwner.created_at ?? null,
        };
      }
    }

    return NextResponse.json({ submission: data, assignedQuestion });
  } catch (error) {
    console.error("[GET /api/submissions/[id]] unexpected error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const score = typeof body?.score === "number" ? body.score : null;
    const feedback = typeof body?.feedback === "string" ? body.feedback : null;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("submissions")
      .update({ score, feedback, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("[PATCH /api/submissions/[id]] supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, submission: data });
  } catch (error) {
    console.error("[PATCH /api/submissions/[id]] unexpected error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await context.params;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("submissions").delete().eq("id", id);

    if (error) {
      console.error("[DELETE /api/submissions/[id]] supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/submissions/[id]] unexpected error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
