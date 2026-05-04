"use client";

import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";

export default function LoginPage() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const check = async () => {
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
    <main ref={rootRef} className="flex min-h-screen items-center justify-center bg-zinc-200 p-4 text-zinc-900">
      <div data-animate="login-card" className="w-full max-w-md rounded-xl border border-zinc-300 bg-white p-6 shadow-xl">
        <div className="mb-3 flex justify-center">
          <Image
            src="/labti.png"
            alt="LabTI Logo"
            width={120}
            height={120}
            priority
            className="h-auto w-[120px]"
          />
        </div>

        <h1 className="text-2xl font-bold">Ujian Praktikum Sistem Operasi</h1>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <input
            data-animate="login-field"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2"
            placeholder="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <div data-animate="login-field" className="relative">
            <input
              type={showPassword ? "text" : "password"}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 pr-16"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-600 hover:text-zinc-900"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button
            data-animate="login-field"
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-orange-500 px-4 py-2 font-semibold text-zinc-900 disabled:opacity-60"
          >
            {loading ? "Loading..." : "Login"}
          </button>
        </form>
      </div>
    </main>
  );
}
