"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";
import Image from "next/image";
import { AppLoadingScreen } from "@/components/AppLoadingScreen";

export default function LoginPage() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        const response = await fetch("/api/me", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (data.user.role === "admin") {
          router.replace("/admin");
          return;
        }
        router.replace("/");
      } finally {
        setCheckingSession(false);
      }
    };
    void check();
  }, [router]);

  useEffect(() => {
    if (!rootRef.current) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.from("[data-animate='login-card']", {
        y: 20,
        opacity: 0,
        duration: 0.5,
        ease: "power2.out",
      });

      gsap.from("[data-animate='login-field']", {
        y: 12,
        opacity: 0,
        duration: 0.4,
        ease: "power2.out",
        stagger: 0.08,
        delay: 0.1,
      });
    }, rootRef);

    return () => ctx.revert();
  }, []);

  if (checkingSession) {
    return <AppLoadingScreen title="Memuat Halaman Login" subtitle="Mengecek status sesi pengguna..." />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setError(data.message || "Login gagal");
      return;
    }

    if (data.user.role === "admin") {
      router.replace("/admin");
      return;
    }

    router.replace("/");
  };

  return (
    <main
      ref={rootRef}
      className="min-h-screen bg-[linear-gradient(160deg,#ece9e4_0%,#f4f3f1_45%,#ebe8e2_100%)] p-4 text-zinc-900 md:p-8"
    >
      <div data-animate="login-card" className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-6xl overflow-visible bg-transparent md:min-h-[calc(100vh-4rem)] lg:overflow-hidden">
        <aside
          className="relative hidden w-[42%] select-none border-r border-zinc-300/40 bg-transparent p-12 lg:block"
          onDragStart={(event) => event.preventDefault()}
        >
          <h2 className="max-w-xs text-6xl font-semibold leading-[0.95] text-zinc-900">
            Ujian Praktikum
            <span className="block text-orange-500">Sistem Operasi</span>
          </h2>

          <div className="mt-8 h-[2px] w-16 bg-orange-500" />
          <p className="mt-8 max-w-sm text-lg leading-relaxed text-zinc-500">
            Login pakai NPM dan password pakai NPM. Pastikan file jawaban sudah disimpan sebelum submit.
          </p>

          <div className="mt-10 space-y-4 text-sm text-zinc-600">
            <p className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 rounded-full bg-orange-400" />
              Username: gunakan NPM kalian
            </p>
            <p className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 rounded-full bg-orange-400" />
              Password: gunakan NPM kalian
            </p>
            <p className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 rounded-full bg-orange-400" />
              Sebelum submit: compile & run dulu program kamu
            </p>
            <p className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 rounded-full bg-orange-400" />
              Submit hanya 1 kali
            </p>
            <p className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 rounded-full bg-orange-400" />
              Waktu ujian: 90 menit
            </p>
          </div>
        </aside>

        <section className="flex w-full flex-col justify-start overflow-y-auto p-6 pt-2 sm:p-10 lg:w-[58%] lg:justify-center lg:px-14">
          <div className="-mt-8 mb-1 flex justify-center sm:-mt-10">
            <Image
              src="/logo-labti.png"
              alt="Logo LabTI"
              width={220}
              height={220}
              priority
              className="h-auto w-[175px] sm:w-[205px]"
            />
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900">Selamat datang</h1>
          <p className="mt-2 text-zinc-500">Silakan masuk untuk melanjutkan</p>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <div data-animate="login-field">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Username / NPM
              </label>
              <input
                className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-zinc-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                placeholder="Masukkan NPM kamu"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>

            <div data-animate="login-field" className="relative">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Password
              </label>
              <input
                type={showPassword ? "text" : "password"}
                className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 pr-20 text-zinc-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-[35px] rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            {error ? <p className="text-sm text-red-500">{error}</p> : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-orange-500 px-4 py-3 font-semibold text-white transition hover:bg-orange-400 disabled:opacity-60"
            >
              {loading ? "Memproses..." : "Masuk ke Ujian"}
            </button>
          </form>

        </section>
      </div>
    </main>
  );
}
