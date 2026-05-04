"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SubmissionRecord } from "@/lib/types";
import { gsap } from "gsap";

export default function AdminPage() {
  const router = useRouter();
  const rootRef = useRef<HTMLElement | null>(null);
  const [rows, setRows] = useState<SubmissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const me = await fetch("/api/me", { cache: "no-store" });
        const meData = await me.json().catch(() => ({}));
        if (!me.ok) {
          if (me.status === 401) {
            router.replace("/login");
            return;
          }
          setError(meData.error || meData.message || "Gagal memuat sesi.");
          setLoading(false);
          return;
        }

        if (meData.user.role !== "admin") {
          setError("Access denied");
          setLoading(false);
          return;
        }

        const submissionsRes = await fetch("/api/submissions", { cache: "no-store" });
        const submissionsData = await submissionsRes.json().catch(() => ({}));
        if (!submissionsRes.ok) {
          setError(submissionsData.error || submissionsData.message || "Gagal memuat submission.");
          setLoading(false);
          return;
        }

        setRows(submissionsData.submissions ?? []);
        setLoading(false);
      } catch (err) {
        console.error("[/admin] fetch failed:", err);
        setError("Gagal terhubung ke server API. Cek env Supabase dan koneksi.");
        setLoading(false);
      }
    };

    void load();
  }, [router]);

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
  };

  const deleteSubmission = async (id: string) => {
    const ok = window.confirm("Yakin ingin menghapus submission ini?");
    if (!ok) {
      return;
    }

    setDeletingId(id);
    const response = await fetch(`/api/submissions/${id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    setDeletingId(null);

    if (!response.ok) {
      alert(data.error || data.message || "Gagal menghapus submission.");
      return;
    }

    setRows((prev) => prev.filter((item) => item.id !== id));
  };

  useEffect(() => {
    if (loading || !rootRef.current) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.from("[data-animate='admin-shell']", {
        y: 16,
        opacity: 0,
        duration: 0.45,
        ease: "power2.out",
        stagger: 0.08,
      });
    }, rootRef);

    return () => ctx.revert();
  }, [loading]);

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

  if (error) {
    return <main className="min-h-screen bg-zinc-200 p-6 text-red-600">{error}</main>;
  }

  return (
    <main ref={rootRef} className="min-h-screen bg-zinc-200 p-6 text-zinc-900">
      <div className="mx-auto max-w-6xl">
        <div data-animate="admin-shell" className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          </div>
          <button onClick={logout} className="rounded bg-zinc-700 px-3 py-2 text-sm text-white">Logout</button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-zinc-300 bg-zinc-100 p-6 text-zinc-600">Belum ada submission.</div>
        ) : (
          <div data-animate="admin-shell" className="overflow-auto rounded-lg border border-zinc-300 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-100 text-zinc-700">
                <tr>
                  <th className="px-3 py-2">No</th>
                  <th className="px-3 py-2">Nama Praktikan</th>
                  <th className="px-3 py-2">Username</th>
                  <th className="px-3 py-2">Nama File</th>
                  <th className="px-3 py-2">Waktu Submit</th>
                  <th className="px-3 py-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  (() => {
                    const submittedAt =
                      (row as SubmissionRecord & { created_at?: string }).submitted_at ||
                      (row as SubmissionRecord & { created_at?: string }).created_at;
                    return (
                  <tr key={row.id} className="border-t border-zinc-200">
                    <td className="px-3 py-2">{idx + 1}</td>
                    <td className="px-3 py-2">
                      {(row as SubmissionRecord & { student_name?: string }).name ||
                        (row as SubmissionRecord & { student_name?: string }).student_name ||
                        "-"}
                    </td>
                    <td className="px-3 py-2">
                      {(row as SubmissionRecord & { student_username?: string }).username ||
                        (row as SubmissionRecord & { student_username?: string }).student_username ||
                        "-"}
                    </td>
                    <td className="px-3 py-2">
                      {(row as SubmissionRecord & { file_name?: string }).file_name || "-"}
                    </td>
                    <td className="px-3 py-2">
                      {submittedAt ? new Date(submittedAt).toLocaleString() : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        className="inline-flex rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-500"
                        href={`/admin/submissions/${row.id}`}
                      >
                        Lihat Detail
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          void deleteSubmission(row.id);
                        }}
                        disabled={deletingId === row.id}
                        className="ml-2 inline-flex rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingId === row.id ? "Menghapus..." : "Hapus"}
                      </button>
                    </td>
                  </tr>
                    );
                  })()
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

