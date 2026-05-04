"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SubmissionRecord } from "@/lib/types";
import { gsap } from "gsap";

export default function SubmissionDetailPage() {
  const router = useRouter();
  const rootRef = useRef<HTMLElement | null>(null);
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [submission, setSubmission] = useState<SubmissionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const me = await fetch("/api/me", { cache: "no-store" });
        const meData = await me.json().catch(() => ({}));
        if (!me.ok) {
          router.replace("/login");
          return;
        }

        if (meData.user.role !== "admin") {
          setError("Access denied");
          setLoading(false);
          return;
        }

        const res = await fetch(`/api/submissions/${id}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || data.message || "Submission tidak ditemukan");
          setLoading(false);
          return;
        }

        setSubmission(data.submission as SubmissionRecord);
        setLoading(false);
      } catch (err) {
        console.error("[/admin/submissions/[id]] fetch failed:", err);
        setError("Gagal terhubung ke server API.");
        setLoading(false);
      }
    };

    void load();
  }, [id, router]);

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
  };

  useEffect(() => {
    if (loading || !submission || !rootRef.current) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.from("[data-animate='detail-shell']", {
        y: 14,
        opacity: 0,
        duration: 0.45,
        ease: "power2.out",
        stagger: 0.08,
      });
    }, rootRef);

    return () => ctx.revert();
  }, [loading, submission]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-200 p-6 text-zinc-900">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-400 border-t-zinc-700" />
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-600 [animation-delay:-0.2s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-600 [animation-delay:-0.1s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-600" />
          </div>
          <p className="text-sm text-zinc-700">Loading...</p>
        </div>
      </main>
    );
  }

  if (error || !submission) {
    return <main className="min-h-screen bg-zinc-200 p-6 text-red-600">{error || "Error"}</main>;
  }

  const displayName =
    (submission as SubmissionRecord & { student_name?: string }).name ||
    (submission as SubmissionRecord & { student_name?: string }).student_name ||
    "-";
  const displayUsername =
    (submission as SubmissionRecord & { student_username?: string }).username ||
    (submission as SubmissionRecord & { student_username?: string }).student_username ||
    "-";
  const displaySubmittedAt =
    (submission as SubmissionRecord & { created_at?: string }).submitted_at ||
    (submission as SubmissionRecord & { created_at?: string }).created_at;

  return (
    <main ref={rootRef} className="min-h-screen bg-zinc-200 p-6 text-zinc-900">
      <div className="mx-auto max-w-5xl space-y-4">
        <div data-animate="detail-shell" className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Detail Submission</h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/admin")}
              className="rounded bg-zinc-700 px-3 py-2 text-sm text-white"
            >
              Kembali
            </button>
            <button onClick={logout} className="rounded bg-zinc-700 px-3 py-2 text-sm text-white">
              Logout
            </button>
          </div>
        </div>

        <div data-animate="detail-shell" className="space-y-1 rounded border border-zinc-300 bg-zinc-100 p-4 text-sm text-zinc-800">
          <p>Nama: {displayName}</p>
          <p>Username: {displayUsername}</p>
          <p>Nama File: {submission.file_name}</p>
          <p>Path File: {submission.file_path}</p>
          <p>Waktu Submit: {displaySubmittedAt ? new Date(displaySubmittedAt).toLocaleString() : "-"}</p>
        </div>

        <div data-animate="detail-shell" className="rounded border border-zinc-300 bg-zinc-100 p-3">
          <h2 className="mb-2 font-semibold">Isi Kode</h2>
          <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded border border-zinc-300 bg-white p-3 text-sm text-zinc-900">
            {submission.code || "(kosong)"}
          </pre>
        </div>
      </div>
    </main>
  );
}
