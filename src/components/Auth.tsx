import { FormEvent, useEffect, useRef, useState } from "react";

type AuthProps = {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<unknown>;
  onSignup: (email: string, password: string) => Promise<unknown>;
  onForgotPassword: (email: string) => Promise<unknown>;
  onUpdatePassword: (password: string) => Promise<unknown>;
  isSubmitting?: boolean;
  authError?: string | null;
};

export default function Auth({
  isOpen,
  onClose,
  onLogin,
  onSignup,
  onForgotPassword,
  onUpdatePassword,
  isSubmitting = false,
  authError = null
}: AuthProps) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string>("");
  const [localSuccess, setLocalSuccess] = useState<string>("");
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPassword("");
      setConfirmPassword("");
      setLocalError("");
      setLocalSuccess("");
      return;
    }
    prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hashParams.get("type") === "recovery") {
      setMode("reset");
      setLocalSuccess("Seteaza o parola noua pentru contul tau.");
    }
    const tm = setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => clearTimeout(tm);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const root = modalRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) return;
    prevFocusRef.current?.focus?.();
  }, [isOpen]);

  if (!isOpen) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError("");
    setLocalSuccess("");

    if (mode !== "reset" && !email.trim()) {
      setLocalError("Email este obligatoriu.");
      return;
    }

    try {
      if (mode === "login") {
        if (password.length < 6) {
          setLocalError("Parola trebuie sa aiba minim 6 caractere.");
          return;
        }
        await onLogin(email.trim(), password);
        onClose();
      } else if (mode === "signup") {
        if (password.length < 6) {
          setLocalError("Parola trebuie sa aiba minim 6 caractere.");
          return;
        }
        await onSignup(email.trim(), password);
        onClose();
      } else if (mode === "forgot") {
        await onForgotPassword(email.trim());
        setLocalSuccess("Ti-am trimis email cu link pentru reset parola.");
      } else {
        if (password.length < 6) {
          setLocalError("Parola noua trebuie sa aiba minim 6 caractere.");
          return;
        }
        if (password !== confirmPassword) {
          setLocalError("Parolele nu coincid.");
          return;
        }
        await onUpdatePassword(password);
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
        setLocalSuccess("Parola a fost actualizata. Te poti autentifica.");
        setMode("login");
        setPassword("");
        setConfirmPassword("");
      }
    } catch (submitError: unknown) {
      const message = submitError instanceof Error ? submitError.message : "Autentificarea a esuat.";
      setLocalError(message);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-signal-void/80 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:items-center sm:p-4"
      role="presentation"
    >
      <div
        ref={modalRef}
        className="animate-fadeIn w-full max-w-md overflow-hidden rounded-t-2xl border border-white/[0.09] bg-gradient-to-b from-signal-panel/95 to-signal-mist shadow-atelierLg backdrop-blur-2xl sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        aria-describedby="auth-modal-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 border-b border-white/[0.06] px-1 pt-1"
          aria-hidden
        >
          <div className="h-0.5 flex-1 rounded-full bg-gradient-to-r from-transparent via-signal-petrol/60 to-transparent" />
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-signal-inkMuted">
            Model pulse
          </span>
          <div className="h-0.5 flex-1 rounded-full bg-gradient-to-r from-transparent via-signal-sage/35 to-transparent" />
        </div>

        <div className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-signal-petrolMuted">
                Signal access
              </p>
              <h2 id="auth-modal-title" className="lab-heading mt-1 text-xl">
                {mode === "login" && "Login"}
                {mode === "signup" && "Create account"}
                {mode === "forgot" && "Forgot password"}
                {mode === "reset" && "Set new password"}
              </h2>
              <p id="auth-modal-desc" className="mt-1 text-xs leading-relaxed text-signal-inkMuted">
                Acceseaza functiile personalizate Footy Predictor.
              </p>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full border border-white/10 bg-signal-fog/90 px-3 py-1.5 text-xs font-semibold text-signal-inkMuted transition hover:border-signal-line hover:bg-signal-panel hover:text-signal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/45"
            >
              Close
            </button>
          </div>

          <form onSubmit={(event) => void onSubmit(event)} className="space-y-3">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-signal-inkMuted">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={mode === "reset"}
                className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-signal-petrol/35"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>

            {mode !== "forgot" && (
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-signal-inkMuted">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-signal-petrol/35"
                  placeholder="******"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </label>
            )}

            {mode === "reset" && (
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-signal-inkMuted">
                Confirm password
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-signal-petrol/35"
                  placeholder="******"
                  autoComplete="new-password"
                />
              </label>
            )}

            {(localError || authError) && (
              <div role="alert" aria-live="assertive" className="rounded-xl border border-signal-rose/35 bg-signal-rose/10 px-3 py-2 text-xs font-semibold text-signal-rose">
                {localError || authError}
              </div>
            )}
            {localSuccess && (
              <div role="status" aria-live="polite" className="rounded-xl border border-signal-sage/35 bg-signal-sage/10 px-3 py-2 text-xs font-semibold text-signal-mint">
                {localSuccess}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-signal-petrol px-4 py-2.5 text-sm font-semibold text-signal-mist shadow-frost transition hover:bg-signal-petrolDeep disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/45"
            >
              {isSubmitting
                ? "Se proceseaza..."
                : mode === "login"
                  ? "Login"
                  : mode === "signup"
                    ? "Sign up"
                    : mode === "forgot"
                      ? "Trimite link reset"
                      : "Actualizeaza parola"}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-4">
            {(mode === "login" || mode === "signup") && (
              <button
                type="button"
                onClick={() => setMode((prev) => (prev === "login" ? "signup" : "login"))}
                className="text-xs font-semibold text-signal-petrol transition hover:text-signal-mint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/35 rounded-sm"
              >
                {mode === "login"
                  ? "Nu ai cont? Creeaza unul."
                  : "Ai deja cont? Intra in aplicatie."}
              </button>
            )}
            {mode === "login" && (
              <button
                type="button"
                onClick={() => setMode("forgot")}
                className="text-xs font-semibold text-signal-amberSoft/90 transition hover:text-signal-amber focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-amber/40 rounded-sm"
              >
                Ai uitat parola?
              </button>
            )}
            {(mode === "forgot" || mode === "reset") && (
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setLocalError("");
                  setLocalSuccess("");
                }}
                className="text-xs font-semibold text-signal-petrol transition hover:text-signal-mint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/35 rounded-sm"
              >
                Inapoi la login
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
