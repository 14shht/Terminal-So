"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppUser, SubmissionRecord } from "@/lib/types";

export default function SubmissionDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [user, setUser] = useState<AppUser | null>(null);
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

        setUser(meData.user);

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

  if (loading) {
    return <main className="min-h-screen bg-[#120414] p-6 text-zinc-100">Loading...</main>;
  }

  if (error || !submission) {
    return <main className="min-h-screen bg-[#120414] p-6 text-red-300">{error || "Error"}</main>;
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
    <main className="min-h-screen bg-[#120414] p-6 text-zinc-100">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Detail Submission</h1>
            <p className="text-sm text-zinc-400">Admin: {user?.name}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push("/admin")} className="rounded bg-zinc-700 px-3 py-2 text-sm">Kembali</button>
            <button onClick={logout} className="rounded bg-zinc-700 px-3 py-2 text-sm">Logout</button>
          </div>
        </div>

        <div className="rounded border border-zinc-700 bg-zinc-900 p-4 text-sm space-y-1">
          <p>Nama: {displayName}</p>
          <p>Username: {displayUsername}</p>
          <p>Nama File: {submission.file_name}</p>
          <p>Path File: {submission.file_path}</p>
          <p>Waktu Submit: {displaySubmittedAt ? new Date(displaySubmittedAt).toLocaleString() : "-"}</p>
        </div>

        <div className="rounded border border-zinc-700 bg-zinc-950 p-3">
          <h2 className="mb-2 font-semibold">Isi Kode</h2>
          <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded bg-black p-3 text-sm text-zinc-200">
            {submission.code || "(kosong)"}
          </pre>
        </div>
      </div>
    </main>
  );
}
