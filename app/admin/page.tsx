"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { SubmissionRecord } from "@/lib/types";
import { gsap } from "gsap";
import { AppLoadingScreen } from "@/components/AppLoadingScreen";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InputDialog } from "@/components/ui/InputDialog";
import { AppToast, ToastStack } from "@/components/ui/ToastStack";
import { ToggleStatusLogin } from "@/components/ToggleStatusLogin";
import { GlobalExamControlPanel } from "@/components/GlobalExamControlPanel";

type AdminUserRow = {
  id: string;
  username: string;
  role: "admin" | "student";
  isActive: boolean;
  created_at: string;
  questionPdfUrl?: string | null;
  timer?: {
    remainingSeconds: number;
    isPausedIndividual: boolean;
    endedAt: string | null;
    endedReason: string | null;
  } | null;
};

const normalizeAdminUser = (user: Partial<AdminUserRow> & Pick<AdminUserRow, "id" | "username" | "role" | "created_at">): AdminUserRow => ({
  ...user,
  isActive: user.isActive ?? true,
  questionPdfUrl: user.questionPdfUrl ?? null,
  timer: user.timer ?? null,
});

type AdminSection = "submissions" | "accounts";
const ADMIN_SECTION_STORAGE_KEY = "admin-dashboard-active-section";

export default function AdminPage() {
  const router = useRouter();
  const rootRef = useRef<HTMLElement | null>(null);
  const [activeSection, setActiveSection] = useState<AdminSection>(() => {
    if (typeof window === "undefined") return "submissions";
    const stored = window.localStorage.getItem(ADMIN_SECTION_STORAGE_KEY);
    return stored === "accounts" ? "accounts" : "submissions";
  });

  const [rows, setRows] = useState<SubmissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "student">("student");
  const [creatingUser, setCreatingUser] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [updatingLoginStatusUserId, setUpdatingLoginStatusUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [meUsername, setMeUsername] = useState("");
  const [meUserId, setMeUserId] = useState("");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const roleMenuRef = useRef<HTMLDivElement | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<AdminUserRow | null>(null);
  const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [examDurationMinutes] = useState(90);
  const [updatingTimerUserId, setUpdatingTimerUserId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const [confirmDeleteSubmissionId, setConfirmDeleteSubmissionId] = useState<string | null>(null);
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [confirmForceFinishUserId, setConfirmForceFinishUserId] = useState<string | null>(null);
  const [confirmReopenUserId, setConfirmReopenUserId] = useState<string | null>(null);
  const [passwordDialogUserId, setPasswordDialogUserId] = useState<string | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [passwordDialogError, setPasswordDialogError] = useState("");
  const [timerDialogUserId, setTimerDialogUserId] = useState<string | null>(null);
  const [timerMinutesInput, setTimerMinutesInput] = useState("5");
  const [timerDialogError, setTimerDialogError] = useState("");
  const toastIdRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ADMIN_SECTION_STORAGE_KEY, activeSection);
  }, [activeSection]);

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

        setMeUsername(meData.user.username ?? "");
        setMeUserId(meData.user.id ?? "");

        const [submissionsRes, usersRes] = await Promise.all([
          fetch("/api/submissions", { cache: "no-store" }),
          fetch("/api/admin/users", { cache: "no-store" }),
        ]);

        const submissionsData = await submissionsRes.json().catch(() => ({}));
        const usersData = await usersRes.json().catch(() => ({}));

        if (!submissionsRes.ok) {
          setError(submissionsData.error || submissionsData.message || "Gagal memuat submission.");
          setLoading(false);
          return;
        }

        if (!usersRes.ok) {
          setUsersError(usersData.error || usersData.message || "Gagal memuat data user.");
        } else {
          setUsers((usersData.users ?? []).map(normalizeAdminUser));
        }

        setUsersLoading(false);
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

  const pushToast = (message: string, tone: "success" | "error" = "success") => {
    toastIdRef.current += 1;
    const id = `toast-${toastIdRef.current}`;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 2800);
  };

  const deleteSubmission = async (id: string) => {
    setDeletingId(id);
    const response = await fetch(`/api/submissions/${id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    setDeletingId(null);

    if (!response.ok) {
      pushToast(data.error || data.message || "Gagal menghapus submission.", "error");
      return false;
    }

    setRows((prev) => prev.filter((item) => item.id !== id));
    pushToast("Submission berhasil dihapus.");
    return true;
  };

  const createUser = async () => {
    const username = newUsername.trim();
    const password = newPassword;
    if (!username || !password) {
      pushToast("Username dan password wajib diisi.", "error");
      return false;
    }

    setCreatingUser(true);
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, role: newRole }),
    });
    const data = await response.json().catch(() => ({}));
    setCreatingUser(false);

    if (!response.ok) {
      pushToast(data.error || data.message || "Gagal membuat user.", "error");
      return false;
    }

    setUsers((prev) => [normalizeAdminUser(data.user), ...prev]);
    setNewUsername("");
    setNewPassword("");
    setNewRole("student");
    setRoleOpen(false);
    pushToast("Akun berhasil dibuat.");
    return true;
  };

  const updateUser = async (id: string, payload: { role?: "admin" | "student"; password?: string }) => {
    setUpdatingUserId(id);
    const response = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    setUpdatingUserId(null);

    if (!response.ok) {
      pushToast(data.error || data.message || "Gagal update user.", "error");
      return false;
    }

    setUsers((prev) => prev.map((item) => (item.id === id ? normalizeAdminUser(data.user) : item)));
    pushToast("Akun berhasil diupdate.");
    return true;
  };

  const deleteUser = async (id: string) => {
    setDeletingUserId(id);
    const response = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    setDeletingUserId(null);

    if (!response.ok) {
      pushToast(data.error || data.message || "Gagal menghapus akun.", "error");
      return false;
    }

    setUsers((prev) => prev.filter((item) => item.id !== id));
    pushToast("Akun berhasil dihapus.");
    return true;
  };

  const updateLoginStatusUser = async (id: string, nextIsActive: boolean) => {
    const previousUser = users.find((item) => item.id === id);
    if (!previousUser) {
      return false;
    }
    if (previousUser.id === meUserId && !nextIsActive) {
      pushToast("Tidak bisa menonaktifkan akun sendiri.", "error");
      return false;
    }

    setUpdatingLoginStatusUserId(id);
    setUsers((prev) => prev.map((item) => (item.id === id ? { ...item, isActive: nextIsActive } : item)));

    const response = await fetch(`/api/admin/users/${id}/login-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: nextIsActive }),
    });
    const data = await response.json().catch(() => ({}));
    setUpdatingLoginStatusUserId(null);

    if (!response.ok) {
      setUsers((prev) =>
        prev.map((item) => (item.id === id ? { ...item, isActive: previousUser.isActive } : item)),
      );
      pushToast(data.error || data.message || "Gagal mengubah status login akun.", "error");
      return false;
    }

    setUsers((prev) => prev.map((item) => (item.id === id ? normalizeAdminUser(data.user) : item)));
    pushToast(nextIsActive ? "Akun berhasil diaktifkan." : "Akun berhasil dinonaktifkan.");
    return true;
  };

  const runUserTimerAction = async (
    userId: string,
    payload:
      | { action: "add_time"; minutes: number }
      | { action: "toggle_pause"; nextPaused: boolean }
      | { action: "reset_timer" }
      | { action: "force_finish" }
      | { action: "reopen_exam" },
  ) => {
    setUpdatingTimerUserId(userId);
    const response = await fetch(`/api/admin/users/${userId}/timer`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    setUpdatingTimerUserId(null);
    if (!response.ok) {
      pushToast(data.error || "Gagal update timer student.", "error");
      return false;
    }
    return true;
  };

  const uploadQuestionPdf = async () => {
    if (!selectedStudent) {
      setUploadError("User tidak ditemukan.");
      return;
    }
    if (!selectedPdfFile) {
      setUploadError("Pilih file PDF terlebih dahulu.");
      return;
    }

    const validationError = validatePdfFile(selectedPdfFile);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setIsUploading(true);
    setUploadError("");

    const formData = new FormData();
    formData.append("file", selectedPdfFile);

    const response = await fetch(`/api/admin/students/${selectedStudent.id}/question-pdf`, {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    setIsUploading(false);

    if (!response.ok) {
      setUploadError(data.error || "Gagal mengupload soal PDF.");
      return;
    }

    setUsers((prev) =>
      prev.map((user) =>
        user.id === selectedStudent.id
          ? { ...user, questionPdfUrl: data.user?.questionPdfUrl || `/api/questions/${user.id}/pdf` }
          : user,
      ),
    );
    pushToast("Soal PDF berhasil diupload.");
    resetUploadModalState();
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

  useEffect(() => {
    const onOutsideClick = (event: MouseEvent) => {
      if (!roleMenuRef.current) {
        return;
      }
      if (!roleMenuRef.current.contains(event.target as Node)) {
        setRoleOpen(false);
      }
    };

    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) {
        URL.revokeObjectURL(pdfPreviewUrl);
      }
    };
  }, [pdfPreviewUrl]);

  const resetUploadModalState = () => {
    if (pdfPreviewUrl) {
      URL.revokeObjectURL(pdfPreviewUrl);
    }
    setSelectedPdfFile(null);
    setPdfPreviewUrl(null);
    setUploadError("");
    setIsUploading(false);
    setIsUploadModalOpen(false);
    setSelectedStudent(null);
  };

  const openUploadModal = (student: AdminUserRow) => {
    if (pdfPreviewUrl) {
      URL.revokeObjectURL(pdfPreviewUrl);
    }
    setSelectedStudent(student);
    setSelectedPdfFile(null);
    setPdfPreviewUrl(null);
    setUploadError("");
    setIsUploadModalOpen(true);
  };

  const validatePdfFile = (file: File) => {
    if (!file) {
      return "Pilih file PDF terlebih dahulu.";
    }
    const isPdf = file.type === "application/pdf" && file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return "File harus berupa PDF.";
    }
    if (file.size > 10 * 1024 * 1024) {
      return "Ukuran PDF maksimal 10MB.";
    }
    return "";
  };

  const onSelectPdfFile = (file: File | null) => {
    if (!file) {
      setUploadError("Pilih file PDF terlebih dahulu.");
      return;
    }

    const validationError = validatePdfFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    if (pdfPreviewUrl) {
      URL.revokeObjectURL(pdfPreviewUrl);
    }
    setSelectedPdfFile(file);
    setUploadError("");
    setPdfPreviewUrl(URL.createObjectURL(file));
  };

  const passwordTargetUser = users.find((user) => user.id === passwordDialogUserId) ?? null;
  const timerTargetUser = users.find((user) => user.id === timerDialogUserId) ?? null;

  if (loading) {
    return <AppLoadingScreen title="Memuat Admin Dashboard" subtitle="Menyiapkan data submission dan akun..." />;
  }

  if (error) {
    return <main className="min-h-screen bg-zinc-100 p-6 text-red-600">{error}</main>;
  }

  return (
    <main
      ref={rootRef}
      className="min-h-screen bg-[linear-gradient(165deg,#efefec_0%,#f6f5f2_45%,#ecebe7_100%)] p-4 text-zinc-900 md:p-8"
    >
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((item) => item.id !== id))} />
      <div className="mx-auto max-w-7xl">
        <div
          data-animate="admin-shell"
          className="mb-5 rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-[0_12px_35px_-20px_rgba(0,0,0,0.45)] backdrop-blur md:p-5"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-600">Control Center</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">Admin Dashboard</h1>
            </div>
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700"
            >
              Logout
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveSection("submissions")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeSection === "submissions"
                  ? "bg-orange-500 text-white shadow-sm"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              Cek Submission
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("accounts")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeSection === "accounts"
                  ? "bg-orange-500 text-white shadow-sm"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              Buat & Kelola Akun
            </button>
          </div>
        </div>

        {activeSection === "submissions" ? (
          <section
            data-animate="admin-shell"
            className="rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-[0_15px_40px_-24px_rgba(0,0,0,0.5)] md:p-5"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Daftar Submission</h2>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">
                Total: {rows.length}
              </span>
            </div>

            {rows.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-6 text-zinc-600">
                Belum ada submission.
              </div>
            ) : (
              <div className="overflow-auto rounded-lg border border-zinc-200">
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
                    {rows.map((row, idx) => {
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
                                setConfirmDeleteSubmissionId(row.id);
                              }}
                              disabled={deletingId === row.id}
                              className="ml-2 inline-flex rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {deletingId === row.id ? "Menghapus..." : "Hapus"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <section
            data-animate="admin-shell"
            className="rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-[0_15px_40px_-24px_rgba(0,0,0,0.5)] md:p-5"
          >
            <GlobalExamControlPanel onToast={pushToast} />
            <h2 className="text-xl font-semibold">Buat & Kelola Akun</h2>

            <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-2.5 md:p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Buat Akun Baru</p>
              <div className="grid gap-1.5 md:grid-cols-4">
              <input
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
                placeholder="Username / NPM"
                className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[13px] outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
              <input
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Password"
                className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[13px] outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
              <div
                ref={roleMenuRef}
                onClick={() => setRoleOpen((prev) => !prev)}
                className="relative cursor-pointer rounded-md border border-zinc-200 bg-white px-2 py-0.5 shadow-sm transition hover:border-zinc-300 hover:shadow"
              >
                <p className="mb-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Role Akses</p>
                <button
                  type="button"
                  className="flex w-full items-center justify-between bg-transparent text-[13px] font-semibold text-zinc-800 outline-none"
                >
                  <span className="capitalize">{newRole}</span>
                  <span className={`text-zinc-500 transition-transform ${roleOpen ? "rotate-180" : "rotate-0"}`}>▼</span>
                </button>
                {roleOpen ? (
                  <div
                    onClick={(event) => event.stopPropagation()}
                    className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_12px_30px_-18px_rgba(0,0,0,0.55)]"
                  >
                    {(["student", "admin"] as const).map((roleOption) => (
                      <button
                        key={roleOption}
                        type="button"
                        onClick={() => {
                          setNewRole(roleOption);
                          setRoleOpen(false);
                        }}
                        className={`flex w-full items-center justify-between px-2.5 py-1 text-left text-[13px] transition ${
                          newRole === roleOption
                            ? "bg-orange-50 font-semibold text-orange-700"
                            : "text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        <span className="capitalize">{roleOption}</span>
                        {newRole === roleOption ? <span className="text-xs">Selected</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  void createUser();
                }}
                disabled={creatingUser}
                            className="rounded-md bg-orange-500 px-3 py-0.5 text-[13px] font-semibold text-white transition hover:bg-orange-400 disabled:opacity-60"
              >
                {creatingUser ? "Menyimpan..." : "Tambah Akun"}
              </button>
              </div>
            </div>

            {usersError ? <p className="mt-3 text-sm text-red-600">{usersError}</p> : null}
            {usersLoading ? (
              <p className="mt-3 text-sm text-zinc-500">Memuat data user...</p>
            ) : (
              <div className="mt-4 overflow-x-auto overflow-y-hidden rounded-lg border border-zinc-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-100 text-zinc-700">
                    <tr>
                      <th className="px-3 py-2">Username</th>
                      <th className="px-3 py-2">Role</th>
                      <th className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          Status Login
                          <span
                            title="Mengatur apakah akun dapat login ke sistem."
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-bold text-zinc-600"
                            aria-label="Info status login"
                          >
                            i
                          </span>
                        </span>
                      </th>
                      <th className="px-3 py-2">Dibuat</th>
                      <th className="px-3 py-2">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((item) => {
                      const isAdminRow = item.role === "admin";
                      const isSelfRow = item.id === meUserId;
                      const isStudentFinished = Boolean(item.timer?.endedAt) || item.timer?.endedReason === "submitted";
                      return (
                      <tr key={item.id} className="border-t border-zinc-200">
                        <td className="px-3 py-2">{item.username}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              item.role === "admin"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {item.role}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <ToggleStatusLogin
                            checked={item.isActive}
                            loading={updatingLoginStatusUserId === item.id}
                            disabled={updatingLoginStatusUserId === item.id || (isSelfRow && item.isActive)}
                            selfDisabled={isSelfRow && item.isActive}
                            onChange={(nextValue) => {
                              void updateLoginStatusUser(item.id, nextValue);
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          {item.created_at ? new Date(item.created_at).toLocaleString() : "-"}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
                          {item.role === "student" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openUploadModal(item)}
                                className="whitespace-nowrap rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500"
                              >
                                {item.questionPdfUrl ? "Ganti Soal" : "Upload Soal"}
                              </button>
                              <a
                                href={item.questionPdfUrl || "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => {
                                  if (!item.questionPdfUrl) event.preventDefault();
                                }}
                                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                                  item.questionPdfUrl
                                    ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                                    : "cursor-not-allowed bg-zinc-100 text-zinc-400"
                                }`}
                              >
                                Lihat Soal
                              </a>
                            </>
                          ) : null}
                          {item.role === "student" ? (
                            <DropdownMenu.Root modal={false}>
                              <DropdownMenu.Trigger
                                disabled={updatingTimerUserId === item.id}
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                >
                                  <circle cx="12" cy="13" r="8" />
                                  <path d="M12 9v4l2 2" />
                                  <path d="M9 3h6" />
                                </svg>
                                Timer
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.51a.75.75 0 01-1.08 0l-4.25-4.51a.75.75 0 01.02-1.06z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              </DropdownMenu.Trigger>
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content
                                  sideOffset={8}
                                  align="end"
                                  collisionPadding={12}
                                  className="timer-dropdown-scroll z-[220] max-h-56 w-48 overflow-y-auto overflow-x-hidden rounded-xl border border-zinc-200 bg-white p-0.5 shadow-[0_18px_45px_-22px_rgba(0,0,0,0.55)]"
                                >
                                  <DropdownMenu.Item
                                    onClick={() => {
                                      setTimerDialogUserId(item.id);
                                      setTimerMinutesInput("5");
                                      setTimerDialogError("");
                                    }}
                                    disabled={isStudentFinished || updatingTimerUserId === item.id}
                                    className="block w-full cursor-pointer rounded-md px-3 py-2 text-left text-xs font-semibold text-indigo-700 outline-none transition hover:bg-indigo-50 focus:bg-indigo-50 data-[disabled]:cursor-not-allowed data-[disabled]:text-zinc-400 data-[disabled]:hover:bg-transparent"
                                  >
                                    Tambah Timer
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Item
                                    onClick={() => {
                                      void (async () => {
                                        const ok = await runUserTimerAction(item.id, {
                                          action: "toggle_pause",
                                          nextPaused: !Boolean(item.timer?.isPausedIndividual),
                                        });
                                        if (ok) {
                                          setUsers((prev) =>
                                            prev.map((u) =>
                                              u.id === item.id
                                                ? {
                                                    ...u,
                                                    timer: {
                                                      remainingSeconds: u.timer?.remainingSeconds ?? 0,
                                                      isPausedIndividual: !Boolean(u.timer?.isPausedIndividual),
                                                      endedAt: u.timer?.endedAt ?? null,
                                                      endedReason: u.timer?.endedReason ?? null,
                                                    },
                                                  }
                                                : u,
                                            ),
                                          );
                                        }
                                      })();
                                    }}
                                    disabled={isStudentFinished || updatingTimerUserId === item.id}
                                    className="block w-full cursor-pointer rounded-md px-3 py-2 text-left text-xs font-semibold text-amber-700 outline-none transition hover:bg-amber-50 focus:bg-amber-50 data-[disabled]:cursor-not-allowed data-[disabled]:text-zinc-400 data-[disabled]:hover:bg-transparent"
                                  >
                                    {item.timer?.isPausedIndividual ? "Resume Timer" : "Pause Timer"}
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Item
                                    onClick={() => {
                                      void (async () => {
                                        const ok = await runUserTimerAction(item.id, { action: "reset_timer" });
                                        if (ok) {
                                          pushToast("Timer student berhasil direset.");
                                        }
                                      })();
                                    }}
                                    disabled={isStudentFinished || updatingTimerUserId === item.id}
                                    className="block w-full cursor-pointer rounded-md px-3 py-2 text-left text-xs font-semibold text-rose-700 outline-none transition hover:bg-rose-50 focus:bg-rose-50 data-[disabled]:cursor-not-allowed data-[disabled]:text-zinc-400 data-[disabled]:hover:bg-transparent"
                                  >
                                    Reset Timer
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Separator className="my-0.5 h-px bg-zinc-200" />
                                  <DropdownMenu.Item
                                    onClick={() => {
                                      setConfirmForceFinishUserId(item.id);
                                    }}
                                    disabled={isStudentFinished || updatingTimerUserId === item.id}
                                    className="block w-full cursor-pointer rounded-md px-3 py-2 text-left text-xs font-semibold text-red-700 outline-none transition hover:bg-red-50 focus:bg-red-50 data-[disabled]:cursor-not-allowed data-[disabled]:text-zinc-400 data-[disabled]:hover:bg-transparent"
                                  >
                                    Akhiri Ujian
                                  </DropdownMenu.Item>
                                  {isStudentFinished ? (
                                    <>
                                      <DropdownMenu.Separator className="my-0.5 h-px bg-zinc-200" />
                                      <DropdownMenu.Item
                                        onClick={() => {
                                          setConfirmReopenUserId(item.id);
                                        }}
                                        disabled={updatingTimerUserId === item.id}
                                        className="block w-full cursor-pointer rounded-md px-3 py-2 text-left text-xs font-semibold text-emerald-700 outline-none transition hover:bg-emerald-50 focus:bg-emerald-50 data-[disabled]:cursor-not-allowed data-[disabled]:text-zinc-400 data-[disabled]:hover:bg-transparent"
                                      >
                                        Buka Ujian Lagi
                                      </DropdownMenu.Item>
                                    </>
                                  ) : null}
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu.Root>
                          ) : null}
                          {item.role === "admin" ? (
                            <span className="whitespace-nowrap rounded-md bg-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-600">
                              Role Terkunci
                            </span>
                          ) : null}
                          {item.role === "admin" ? (
                            <button
                              type="button"
                              onClick={() => {
                                setPasswordDialogUserId(item.id);
                                setNewPasswordInput("");
                                setPasswordDialogError("");
                              }}
                              disabled={updatingUserId === item.id}
                              className="whitespace-nowrap rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-500 disabled:opacity-60"
                            >
                              Reset Password
                            </button>
                          ) : null}

                          <DropdownMenu.Root modal={false}>
                            <DropdownMenu.Trigger className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50">
                              Lainnya
                              <span aria-hidden="true">⋯</span>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                sideOffset={8}
                                align="end"
                                collisionPadding={12}
                                className="z-[220] min-w-44 rounded-xl border border-zinc-200 bg-white p-0.5 shadow-[0_18px_45px_-22px_rgba(0,0,0,0.55)]"
                              >
                                {item.role === "student" ? (
                                  <DropdownMenu.Item
                                    onClick={() => {
                                      void updateUser(item.id, { role: "admin" });
                                    }}
                                    disabled={updatingUserId === item.id}
                                    className="block w-full cursor-pointer rounded-md px-3 py-2 text-left text-xs font-semibold text-zinc-700 outline-none transition hover:bg-zinc-50 focus:bg-zinc-50 data-[disabled]:cursor-not-allowed data-[disabled]:text-zinc-400"
                                  >
                                    Jadikan Admin
                                  </DropdownMenu.Item>
                                ) : null}
                                <DropdownMenu.Item
                                  onClick={() => {
                                    setPasswordDialogUserId(item.id);
                                    setNewPasswordInput("");
                                    setPasswordDialogError("");
                                  }}
                                  disabled={updatingUserId === item.id}
                                  className="block w-full cursor-pointer rounded-md px-3 py-2 text-left text-xs font-semibold text-amber-700 outline-none transition hover:bg-amber-50 focus:bg-amber-50 data-[disabled]:cursor-not-allowed data-[disabled]:text-zinc-400"
                                >
                                  Reset Password
                                </DropdownMenu.Item>
                                <DropdownMenu.Separator className="my-0.5 h-px bg-zinc-200" />
                                <DropdownMenu.Item
                                  onClick={() => {
                                    if (item.username === meUsername) {
                                      pushToast("Akun admin yang sedang login tidak bisa dihapus.", "error");
                                      return;
                                    }
                                    setConfirmDeleteUserId(item.id);
                                  }}
                                  disabled={deletingUserId === item.id || item.username === meUsername || isAdminRow}
                                  className="block w-full cursor-pointer rounded-md px-3 py-2 text-left text-xs font-semibold text-red-700 outline-none transition hover:bg-red-50 focus:bg-red-50 data-[disabled]:cursor-not-allowed data-[disabled]:text-zinc-400 data-[disabled]:hover:bg-transparent"
                                >
                                  {deletingUserId === item.id ? "Menghapus..." : "Hapus Akun"}
                                </DropdownMenu.Item>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(confirmDeleteSubmissionId)}
        onOpenChange={(open) => !open && setConfirmDeleteSubmissionId(null)}
        title="Hapus Submission"
        description="Yakin ingin menghapus submission ini?"
        confirmLabel="Hapus"
        destructive
        loading={deletingId === confirmDeleteSubmissionId}
        onConfirm={() => {
          const id = confirmDeleteSubmissionId;
          if (!id) return;
          void deleteSubmission(id).then((ok) => {
            if (ok) setConfirmDeleteSubmissionId(null);
          });
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteUserId)}
        onOpenChange={(open) => !open && setConfirmDeleteUserId(null)}
        title="Hapus Akun"
        description="Yakin ingin menghapus akun ini?"
        confirmLabel="Hapus"
        destructive
        loading={deletingUserId === confirmDeleteUserId}
        onConfirm={() => {
          const id = confirmDeleteUserId;
          if (!id) return;
          void deleteUser(id).then((ok) => {
            if (ok) setConfirmDeleteUserId(null);
          });
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmForceFinishUserId)}
        onOpenChange={(open) => !open && setConfirmForceFinishUserId(null)}
        title="Akhiri Ujian"
        description="Yakin ingin mengakhiri ujian mahasiswa ini? Timer akan menjadi 0 dan jawaban akan otomatis disubmit."
        confirmLabel="Akhiri Ujian"
        destructive
        loading={updatingTimerUserId === confirmForceFinishUserId}
        onConfirm={() => {
          const userId = confirmForceFinishUserId;
          if (!userId) return;
          void (async () => {
            const success = await runUserTimerAction(userId, { action: "force_finish" });
            if (success) {
              setUsers((prev) =>
                prev.map((u) =>
                  u.id === userId
                    ? {
                        ...u,
                        timer: {
                          remainingSeconds: 0,
                          isPausedIndividual: false,
                          endedAt: new Date().toISOString(),
                          endedReason: "submitted",
                        },
                      }
                    : u,
                ),
              );
              pushToast("Ujian mahasiswa berhasil diakhiri.");
              setConfirmForceFinishUserId(null);
            }
          })();
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmReopenUserId)}
        onOpenChange={(open) => !open && setConfirmReopenUserId(null)}
        title="Buka Ujian Lagi"
        description="Yakin ingin membuka kembali ujian mahasiswa ini?"
        confirmLabel="Buka Ujian"
        loading={updatingTimerUserId === confirmReopenUserId}
        onConfirm={() => {
          const userId = confirmReopenUserId;
          if (!userId) return;
          void (async () => {
            const success = await runUserTimerAction(userId, { action: "reopen_exam" });
            if (success) {
              setUsers((prev) =>
                prev.map((u) =>
                  u.id === userId
                    ? {
                        ...u,
                        timer: {
                          remainingSeconds: examDurationMinutes * 60,
                          isPausedIndividual: false,
                          endedAt: null,
                          endedReason: null,
                        },
                      }
                    : u,
                ),
              );
              pushToast("Ujian mahasiswa berhasil dibuka kembali.");
              setConfirmReopenUserId(null);
            }
          })();
        }}
      />

      <InputDialog
        open={Boolean(timerDialogUserId)}
        onOpenChange={(open) => !open && setTimerDialogUserId(null)}
        title="Tambah Timer"
        description={`Masukkan jumlah menit tambahan untuk ${timerTargetUser?.username ?? "student"} ini`}
        label="Menit Tambahan"
        helperText="Contoh: 5"
        inputType="number"
        value={timerMinutesInput}
        error={timerDialogError}
        submitLabel="Tambah"
        loading={updatingTimerUserId === timerDialogUserId}
        onValueChange={(value) => {
          setTimerMinutesInput(value);
          setTimerDialogError("");
        }}
        onSubmit={() => {
          const userId = timerDialogUserId;
          if (!userId) return;
          const minutes = Number(timerMinutesInput);
          if (!Number.isFinite(minutes) || minutes <= 0) {
            setTimerDialogError("Menit harus berupa angka lebih dari 0.");
            return;
          }
          void (async () => {
            const ok = await runUserTimerAction(userId, { action: "add_time", minutes });
            if (ok) {
              pushToast("Timer student berhasil ditambah.");
              setTimerDialogUserId(null);
            }
          })();
        }}
      />

      <InputDialog
        open={Boolean(passwordDialogUserId)}
        onOpenChange={(open) => !open && setPasswordDialogUserId(null)}
        title="Reset Password"
        description={`Masukkan password baru untuk ${passwordTargetUser?.username ?? "user"} ini`}
        label="Password Baru"
        inputType="password"
        value={newPasswordInput}
        error={passwordDialogError}
        submitLabel="Simpan"
        loading={updatingUserId === passwordDialogUserId}
        onValueChange={(value) => {
          setNewPasswordInput(value);
          setPasswordDialogError("");
        }}
        onSubmit={() => {
          const userId = passwordDialogUserId;
          const password = newPasswordInput.trim();
          if (!userId) return;
          if (!password) {
            setPasswordDialogError("Password tidak boleh kosong.");
            return;
          }
          void (async () => {
            const ok = await updateUser(userId, { password });
            if (ok) {
              setPasswordDialogUserId(null);
              setNewPasswordInput("");
            }
          })();
        }}
      />

      {isUploadModalOpen && selectedStudent ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            className={`w-full rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-zinc-100 shadow-2xl ${
              selectedPdfFile ? "max-w-4xl" : "max-w-2xl"
            }`}
          >
            <h2 className="text-lg font-semibold">
              {selectedStudent.questionPdfUrl
                ? `Ganti Soal untuk ${selectedStudent.username}`
                : `Upload Soal untuk ${selectedStudent.username}`}
            </h2>
            <p className="mt-1 text-sm text-zinc-300">
              Pilih file PDF (maksimal 10MB), lalu konfirmasi upload.
            </p>

            {!selectedPdfFile ? (
              <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-950 p-4">
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(event) => onSelectPdfFile(event.target.files?.[0] ?? null)}
                  className="block w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                />
                <p className="mt-2 text-xs text-zinc-400">Format: PDF, maksimal 10MB.</p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm">
                  <p>Nama file: {selectedPdfFile.name}</p>
                  <p>Ukuran: {(selectedPdfFile.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                {pdfPreviewUrl ? (
                  <iframe
                    title="Preview Soal PDF"
                    src={pdfPreviewUrl}
                    className="h-[60vh] w-full rounded-lg border border-zinc-700 bg-white"
                  />
                ) : null}
              </div>
            )}

            {uploadError ? <p className="mt-3 text-sm text-red-400">{uploadError}</p> : null}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {selectedPdfFile ? (
                <button
                  type="button"
                  onClick={() => {
                    if (pdfPreviewUrl) {
                      URL.revokeObjectURL(pdfPreviewUrl);
                    }
                    setSelectedPdfFile(null);
                    setPdfPreviewUrl(null);
                    setUploadError("");
                  }}
                  className="rounded-md bg-zinc-700 px-3 py-2 text-sm text-zinc-100"
                >
                  Ganti File
                </button>
              ) : null}
              <button
                type="button"
                onClick={resetUploadModalState}
                className="rounded-md bg-zinc-700 px-3 py-2 text-sm text-zinc-100"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  void uploadQuestionPdf();
                }}
                disabled={!selectedPdfFile || isUploading}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {isUploading ? "Mengupload..." : "Konfirmasi Upload"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
