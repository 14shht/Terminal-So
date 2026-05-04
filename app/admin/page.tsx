"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppUser, SubmissionRecord } from "@/lib/types";

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<AppUser | null>(null);
  const [rows, setRows] = useState<SubmissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

        setUser(meData.user);

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

  if (loading) {
    return <main className="min-h-screen bg-[#120414] p-6 text-zinc-100">Loading...</main>;
  }

  if (error) {
    return <main className="min-h-screen bg-[#120414] p-6 text-red-300">{error}</main>;
  }

  return (
    <main className="min-h-screen bg-[#120414] p-6 text-zinc-100">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
            <p className="text-sm text-zinc-400">Login sebagai {user?.name}</p>
          </div>
          <button onClick={logout} className="rounded bg-zinc-700 px-3 py-2 text-sm">Logout</button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-400">Belum ada submission.</div>
        ) : (
          <div className="overflow-auto rounded-lg border border-zinc-700 bg-zinc-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-800 text-zinc-300">
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
                  <tr key={row.id} className="border-t border-zinc-800">
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
                      <Link className="text-blue-400 hover:underline" href={`/admin/submissions/${row.id}`}>
                        Lihat Detail
                      </Link>
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

