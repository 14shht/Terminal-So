"use client";

type AppLoadingScreenProps = {
  title?: string;
  subtitle?: string;
};

export function AppLoadingScreen({
  title = "Memuat Halaman",
  subtitle = "Menyiapkan data, mohon tunggu...",
}: AppLoadingScreenProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#f5f4f1_0%,#ecebe7_45%,#e6e4df_100%)] p-6 text-zinc-900">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200/80 bg-white/75 p-6 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="mx-auto h-14 w-14 animate-spin rounded-full border-[5px] border-zinc-200 border-t-orange-500" />
        <div className="mt-4 flex items-center justify-center gap-1.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-orange-500 [animation-delay:-0.2s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-700 [animation-delay:-0.1s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-orange-500" />
        </div>
        <p className="mt-4 text-center text-base font-semibold text-zinc-800">{title}</p>
        <p className="mt-1 text-center text-sm text-zinc-500">{subtitle}</p>
      </div>
    </main>
  );
}
