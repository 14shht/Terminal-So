"use client";

type ToggleStatusLoginProps = {
  checked: boolean;
  disabled?: boolean;
  loading?: boolean;
  selfDisabled?: boolean;
  onChange: (nextValue: boolean) => void;
};

export function ToggleStatusLogin({
  checked,
  disabled = false,
  loading = false,
  selfDisabled = false,
  onChange,
}: ToggleStatusLoginProps) {
  const isDisabled = disabled || loading;

  return (
    <div className="min-w-[132px]">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={isDisabled}
        onClick={() => onChange(!checked)}
        className={`group relative inline-flex h-7 w-[62px] items-center rounded-full px-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)] transition-all duration-200 ${
          checked
            ? "bg-gradient-to-r from-indigo-600 to-blue-600"
            : "bg-gradient-to-r from-zinc-300 to-zinc-400"
        } ${isDisabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:scale-[1.015]"}`}
      >
        <span
          className={`absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-semibold tracking-[0.1em] text-white/95 transition ${
            checked ? "opacity-100" : "opacity-0"
          }`}
        >
          ON
        </span>
        <span
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-semibold tracking-[0.1em] text-zinc-700 transition ${
            checked ? "opacity-0" : "opacity-100"
          }`}
        >
          OFF
        </span>
        <span
          className={`h-[18px] w-[18px] rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.25)] transition-transform duration-200 ${
            checked ? "translate-x-[30px]" : "translate-x-0"
          }`}
        />
      </button>
      <p className="mt-1 text-[10px] font-medium leading-tight text-zinc-500">
        {selfDisabled
          ? "Tidak bisa menonaktifkan akun sendiri"
          : checked
            ? "Akun dapat login"
            : "Akun tidak dapat login"}
      </p>
    </div>
  );
}
