"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SubmissionRecord } from "@/lib/types";
import { gsap } from "gsap";
import { AppLoadingScreen } from "@/components/AppLoadingScreen";

export default function SubmissionDetailPage() {
  const router = useRouter();
  const rootRef = useRef<HTMLElement | null>(null);
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [submission, setSubmission] = useState<SubmissionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy Code");

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

  const loadToTerminal = () => {
    if (typeof window === "undefined" || !submission) {
      return;
    }

    const HOME_DIR = "/home/student";
    const storageKey = "ubuntu-web-lab-state-admin";
    const filePath =
      (submission as SubmissionRecord & { file_path?: string }).file_path?.trim() || `${HOME_DIR}/main.c`;
    const normalizedPath = filePath.startsWith("/") ? filePath : `${HOME_DIR}/${filePath}`;
    const pathParts = normalizedPath.split("/").filter(Boolean);
    const parentDir =
      pathParts.length > 1 ? `/${pathParts.slice(0, -1).join("/")}` : HOME_DIR;
    const folders = [HOME_DIR];
    if (parentDir !== HOME_DIR) {
      folders.push(parentDir);
    }
    const code = (submission as SubmissionRecord & { code?: string }).code || "";

    const monitoredUsername =
      (submission as SubmissionRecord & { student_username?: string }).username ||
      (submission as SubmissionRecord & { student_username?: string }).student_username ||
      "";

    const payload = {
      currentDir: parentDir,
      folders,
      files: [
        {
          name: normalizedPath,
          content: code,
          type: "file",
          executable: false,
        },
      ],
      entries: [
        {
          id: `seed-${Date.now()}`,
          prompt: "admin@ubuntu:~$",
          command: "load-submission",
          output: [
            `Loaded submission file: ${normalizedPath}`,
            `Current dir: ${parentDir}`,
            `Jalankan compile: gcc ${pathParts[pathParts.length - 1]} -o out lalu ./out`,
          ],
        },
      ],
      submitted: false,
      monitoredStudentId: submission.user_id ?? "",
      monitoredStudentUsername: monitoredUsername,
    };

    window.localStorage.setItem(storageKey, JSON.stringify(payload));
    const backTo = `/admin/submissions/${id}`;
    const studentId = submission.user_id ?? "";
    const studentUsername = monitoredUsername;
    const query = new URLSearchParams({
      admin_terminal: "1",
      admin_return: backTo,
      ...(studentId ? { admin_student_id: studentId } : {}),
      ...(studentUsername ? { admin_student_username: studentUsername } : {}),
    });
    router.push(`/?${query.toString()}`);
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

  const copyCode = async () => {
    try {
      const text = (submission as SubmissionRecord & { code?: string })?.code || "";
      await navigator.clipboard.writeText(text);
      setCopyLabel("Copied");
      setTimeout(() => setCopyLabel("Copy Code"), 1500);
    } catch {
      setCopyLabel("Gagal Copy");
      setTimeout(() => setCopyLabel("Copy Code"), 1500);
    }
  };

  if (loading) {
    return <AppLoadingScreen title="Memuat Detail Submission" subtitle="Mengambil data kode dan informasi praktikan..." />;
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
    <main
      ref={rootRef}
      className="min-h-screen bg-[linear-gradient(160deg,#efefec_0%,#f6f5f2_45%,#ecebe7_100%)] p-4 text-zinc-900 md:p-8"
    >
      <div className="mx-auto max-w-6xl space-y-4">
        <section
          data-animate="detail-shell"
          className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-[0_14px_40px_-24px_rgba(0,0,0,0.5)] backdrop-blur md:p-5"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-orange-600">Submission Inspector</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">Detail Submission</h1>
              <p className="mt-2 text-sm text-zinc-500">Review kode praktikan, lalu load langsung ke terminal simulator.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadToTerminal}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-blue-500"
              >
                Load ke Terminal
              </button>
              <button
                type="button"
                onClick={() => router.push("/admin")}
                className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-zinc-600"
              >
                Kembali
              </button>
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(true)}
                className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-zinc-700"
              >
                Logout
              </button>
            </div>
          </div>
        </section>

        <section data-animate="detail-shell" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-xs uppercase tracking-[0.1em] text-zinc-500">Nama Praktikan</p>
            <p className="mt-1 text-base font-semibold text-zinc-800">{displayName}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-xs uppercase tracking-[0.1em] text-zinc-500">Username</p>
            <p className="mt-1 text-base font-semibold text-zinc-800">{displayUsername}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-xs uppercase tracking-[0.1em] text-zinc-500">Nama File</p>
            <p className="mt-1 text-base font-semibold text-zinc-800">{submission.file_name || "-"}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md md:col-span-2">
            <p className="text-xs uppercase tracking-[0.1em] text-zinc-500">Path File</p>
            <p className="mt-1 break-all text-sm font-medium text-zinc-700">{submission.file_path || "-"}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-xs uppercase tracking-[0.1em] text-zinc-500">Waktu Submit</p>
            <p className="mt-1 text-sm font-semibold text-zinc-800">
              {displaySubmittedAt ? new Date(displaySubmittedAt).toLocaleString() : "-"}
            </p>
          </div>
        </section>

        <section
          data-animate="detail-shell"
          className="overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 shadow-[0_16px_40px_-26px_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold tracking-wide text-zinc-800">Isi Kode</h2>
              <p className="text-xs text-zinc-500">Readonly preview submission</p>
            </div>
            <button
              type="button"
              onClick={() => {
                void copyCode();
              }}
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-700"
            >
              {copyLabel}
            </button>
          </div>
          <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap bg-[#0f1117] p-4 font-mono text-sm leading-relaxed text-zinc-100">
            {submission.code || "(kosong)"}
          </pre>
        </section>
      </div>

      {showLogoutConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <h2 className="text-lg font-semibold text-zinc-100">Konfirmasi Logout</h2>
            <p className="mt-2 text-sm text-zinc-300">Anda yakin ingin logout?</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="rounded-md bg-zinc-700 px-3 py-2 text-sm text-zinc-100"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLogoutConfirm(false);
                  void logout();
                }}
                className="rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500"
              >
                Ya, Logout
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
