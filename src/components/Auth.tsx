import { FormEvent, useEffect, useState } from "react";

type AuthProps = {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<unknown>;
  onSignup: (email: string, password: string) => Promise<unknown>;
  isSubmitting?: boolean;
  authError?: string | null;
};

export default function Auth({
  isOpen,
  onClose,
  onLogin,
  onSignup,
  isSubmitting = false,
  authError = null
}: AuthProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string>("");

  useEffect(() => {
    if (!isOpen) {
      setPassword("");
      setLocalError("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError("");

    if (!email.trim()) {
      setLocalError("Email este obligatoriu.");
      return;
    }
    if (password.length < 6) {
      setLocalError("Parola trebuie sa aiba minim 6 caractere.");
      return;
    }

    try {
      if (mode === "login") {
        await onLogin(email.trim(), password);
      } else {
        await onSignup(email.trim(), password);
      }
      onClose();
    } catch (submitError: unknown) {
      const message = submitError instanceof Error ? submitError.message : "Autentificarea a esuat.";
      setLocalError(message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl shadow-emerald-900/20">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-white">
              {mode === "login" ? "Login" : "Create account"}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Acceseaza functiile personalizate Footy Predictor.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 px-2 py-1 text-xs font-bold text-slate-300 hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <form onSubmit={(event) => void onSubmit(event)} className="space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-300">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/40"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>

          <label className="block text-xs font-bold uppercase tracking-wide text-slate-300">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/40"
              placeholder="******"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>

          {(localError || authError) && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200">
              {localError || authError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Se proceseaza..." : mode === "login" ? "Login" : "Sign up"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setMode((prev) => (prev === "login" ? "signup" : "login"))}
          className="mt-4 text-xs font-bold text-emerald-300 hover:text-emerald-200"
        >
          {mode === "login"
            ? "Nu ai cont? Creeaza unul."
            : "Ai deja cont? Intra in aplicatie."}
        </button>
      </div>
    </div>
  );
}
