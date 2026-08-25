import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ModelPulseWave } from "../components/SignalLab";
import { BRAND_IMAGES } from "../constants/brandAssets";
import { useLocale } from "../context/LocaleContext";
import AuthLinkNotice from "../components/AuthLinkNotice";
import { useAuth } from "../hooks/useAuth";
import { readCapturedAuthHash } from "../utils/supabaseAuthHash";
import { authErrorMessageKey, isEmailNotConfirmedError, isResendCooldownError } from "../utils/authError";
import { isAuthTimeoutError } from "../utils/authTimeout";
import { HistoryStats } from "../types";

export default function Login() {
  const { t } = useLocale();
  const { user, signup, login, sendPasswordResetEmail, updatePassword, resendConfirmationEmail, lastAuthEvent, error } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /*
    Set only when Supabase says the password was RIGHT but the address is still
    unconfirmed. Anything else — wrong password, unknown user, rate limit — must
    not offer to send mail, so this stays false and the block renders as before.
  */
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState("");
  const [globalStats, setGlobalStats] = useState<HistoryStats>({ wins: 0, losses: 0, settled: 0, winRate: 0, pushes: 0, halfWins: 0, halfLosses: 0 });
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (searchParams.get("mode") === "signup") {
      setMode("signup");
    }
  }, [searchParams]);

  useEffect(() => {
    void fetch("/api/history?days=30")
      .then((response) => response.json())
      .then((json) => {
        if (json?.ok && json.stats) setGlobalStats(json.stats);
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    const hashParams = readCapturedAuthHash();
    if (hashParams.type === "recovery" || lastAuthEvent === "PASSWORD_RECOVERY") {
      setMode("reset");
      setMessage(t("auth.recoveryPrompt"));
    }
    /*
      The signup-confirmed branch that used to live here is gone. It set a
      message on /login, but a confirmation lands on "/" (emailRedirectTo is the
      origin), and this page navigates to /workspace the moment a user appears —
      so it announced success where nobody was looking, and re-announced it on
      every later auth event because the snapshot it read never expires.
      AuthLinkNotice, mounted here AND on the landing page, now owns it through a
      latch that fires once per page load.
    */
  }, [lastAuthEvent, t]);

  /**
   * Explicit, never automatic: a failed login must not send mail on its own.
   * The address is the one already typed, so nothing is re-entered, and the
   * in-flight guard plus the disabled button block a double submit. Success
   * means the email was accepted for delivery — never that the account is
   * confirmed.
   */
  async function onResendConfirmation() {
    if (resending) return;
    const address = email.trim();
    if (!address) {
      setLocalError(t("auth.emailRequiredMsg"));
      return;
    }
    setResending(true);
    setResendNotice(null);
    setLocalError("");
    try {
      await resendConfirmationEmail(address);
      setResendNotice(t("auth.resendSentFromLogin"));
    } catch (resendError: unknown) {
      setResendNotice(null);
      setLocalError(
        isResendCooldownError(resendError)
          ? t("auth.resendCooldownMsg", { seconds: String(resendError.secondsRemaining) })
          : resendError instanceof Error
            ? resendError.message
            : t("auth.resendFailed")
      );
    } finally {
      setResending(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    navigate("/workspace", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redirect is keyed to user.id appearing; whole `user` identity (token refresh) must not re-fire navigation
  }, [user?.id, navigate]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;
    let rafId: number | null = null;
    let pending: { x: number; y: number } | null = null;
    const onMove = (event: MouseEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const nx = (event.clientX - cx) / Math.max(cx, 1);
      const ny = (event.clientY - cy) / Math.max(cy, 1);
      pending = { x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) };
      // Coalesce to one state update per frame — mousemove can fire far faster than
      // the display refreshes, and each update was triggering a full re-render.
      if (rafId == null) {
        rafId = requestAnimationFrame(() => {
          if (pending) setParallax(pending);
          rafId = null;
        });
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError("");
    setMessage("");
    setNeedsConfirmation(false);
    setResendNotice(null);
    if (mode !== "reset" && !email.trim()) {
      setLocalError(t("auth.emailRequiredMsg"));
      return;
    }
    if (mode === "signup" && !privacyAccepted) {
      setLocalError(t("auth.privacyRequiredMsg"));
      return;
    }
    try {
      setSubmitting(true);
      if (mode === "login") {
        await login(email.trim(), password);
      } else if (mode === "signup") {
        await signup(email.trim(), password);
        setMessage(t("auth.signupSuccessMsg"));
      } else if (mode === "forgot") {
        await sendPasswordResetEmail(email.trim());
        setMessage(t("auth.resetSentMsg"));
      } else {
        if (password.length < 6) {
          setLocalError(t("auth.passwordTooShortMsg"));
          return;
        }
        if (password !== confirmPassword) {
          setLocalError(t("auth.passwordMismatchMsg"));
          return;
        }
        await updatePassword(password);
        setMessage(t("auth.passwordUpdatedMsg"));
        setMode("login");
      }
    } catch (submitError: unknown) {
      /*
        The password was right and only confirmation is missing: offer the fix
        here rather than making the user hunt down the old email and click a
        link that has already expired. Keyed on the classifier, so a wrong
        password or a rate limit never reaches this branch.
      */
      if (mode === "login" && isEmailNotConfirmedError(submitError)) {
        setNeedsConfirmation(true);
      }
      /*
        A stalled auth request is a connection problem, not a credentials
        problem, and must never surface as a raw Supabase dump. Neither must a
        recognised auth failure: `AuthApiError` IS an Error, so without the
        classifier the branch below printed GoTrue's English ("Email not
        confirmed") straight into a Romanian screen. Unrecognised failures still
        keep their own text rather than being flattened into one generic.
      */
      const messageKey = authErrorMessageKey(submitError);
      setLocalError(
        isAuthTimeoutError(submitError)
          ? t("auth.timeoutMsg")
          : messageKey
            ? t(messageKey)
            : submitError instanceof Error
              ? submitError.message
              : t("auth.operationFailedMsg")
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lab-page">
      <div className="lab-bg" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-cover bg-center opacity-[0.18] saturate-125 transition-transform duration-75 ease-out"
        style={{
          backgroundImage: `url(${BRAND_IMAGES.landingAccessHero})`,
          transform: `translate3d(${parallax.x * 10}px, ${parallax.y * 10}px, 0)`
        }}
        aria-hidden
      />
      <div
        className="login-ultra-glow pointer-events-none absolute inset-0 z-[1] opacity-[0.05] mix-blend-screen transition-transform duration-75 ease-out"
        style={{
          backgroundImage: `url(${BRAND_IMAGES.heroForesight})`,
          backgroundSize: "120% auto",
          backgroundPosition: "center top",
          transform: `translate3d(${parallax.x * -14}px, ${parallax.y * -14}px, 0)`
        }}
        aria-hidden
      />
      <div className="login-ultra-noise pointer-events-none absolute inset-0 z-[1]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_16%_14%,rgba(56,189,248,0.34),transparent_42%),radial-gradient(circle_at_87%_10%,rgba(251,191,36,0.28),transparent_40%),radial-gradient(circle_at_52%_100%,rgba(244,63,94,0.24),transparent_36%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-fp-bg-elevated/30 via-fp-bg/20 to-fp-bg/88" aria-hidden />
      <div className="pointer-events-none absolute inset-0 z-[1] opacity-30 [background-size:24px_24px] [background-image:linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)]" aria-hidden />
      <div className="relative z-10 mx-auto max-w-[var(--fp-container)] px-4 py-10 sm:py-14">
        <header className="mb-10 border-b border-white/[0.1] pb-8 animate-fadeIn">
          <Link
            to="/"
            className="inline-block font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fp-text-muted)] transition hover:text-[var(--fp-accent)]"
          >
            {t("auth.backLink")}
          </Link>
          <p className="mt-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--fp-accent-text)]">{t("auth.tagline")}</p>
          <img
            src={BRAND_IMAGES.logoPrimary}
            alt="Footy Predictor"
            className="mt-4 h-28 w-28 rounded-[var(--fp-radius)] border-2 border-cyan-300/65 object-contain p-1 brightness-110 saturate-150 shadow-[0_0_44px_rgba(34,211,238,0.5)] animate-[pulse_4s_ease-in-out_infinite] motion-reduce:animate-none sm:h-36 sm:w-36"
          />
          <div className="mt-2 max-w-4xl rounded-[var(--fp-radius)] border border-white/[0.18] bg-fp-bg-card/68 p-4 shadow-[0_0_28px_rgba(56,189,248,0.16)] backdrop-blur-[24px] sm:p-5 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-0">
            <h1 className="font-display text-4xl font-bold leading-[1.03] tracking-tight drop-shadow-[0_0_34px_rgba(56,189,248,0.28)] sm:text-6xl lg:text-7xl">
              <span className="relative inline-block">
                <span
                  className="absolute inset-0 z-0 text-transparent opacity-75 blur-[1px]"
                  style={{ WebkitTextStroke: "1px rgba(94,234,212,0.55)" }}
                  aria-hidden
                >
                  Footy Predictor
                </span>
                <span className="relative z-10 text-[var(--fp-text)] drop-shadow-[0_0_26px_rgba(56,189,248,0.34)]">
                  Footy <span className="text-[var(--fp-accent)]">Predictor</span>
                </span>
              </span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--fp-text)]">{t("auth.heroDesc")}</p>
          </div>
        </header>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,26rem)] lg:items-start xl:gap-14">
          <div className="animate-fadeIn space-y-6 [animation-delay:40ms]">
            <ModelPulseWave status="OPTIMAL CALIBRATION" className="w-full" />

            <div className="rounded-[var(--fp-radius)] border border-fp-success/45 bg-fp-bg-card/80 px-4 py-4 shadow-[0_0_24px_rgba(16,185,129,0.18)] backdrop-blur-[24px]">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fp-accent-text/80">{t("auth.statsTitle")}</p>
              <div className="mt-2 grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="font-mono text-2xl font-semibold tabular-nums text-[var(--fp-success)] sm:text-3xl">
                    {globalStats.settled ? globalStats.winRate.toFixed(1) : "—"}%
                  </div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--fp-text)]">{t("auth.statSuccessRate")}</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-semibold tabular-nums text-[var(--fp-accent-text)] sm:text-3xl">{globalStats.settled || "—"}</div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--fp-text)]">{t("auth.statSettled")}</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-semibold tabular-nums text-[var(--fp-success)] sm:text-3xl">
                    {globalStats.wins + globalStats.losses > 0 ? `${globalStats.wins}W/${globalStats.losses}L` : "—"}
                  </div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--fp-text)]">{t("auth.statRecord")}</div>
                </div>
              </div>
            </div>

            <section className="rounded-[var(--fp-radius)] border border-white/[0.2] bg-fp-bg-card/80 p-4 shadow-[0_0_20px_rgba(56,189,248,0.14)] backdrop-blur-[24px]">
              <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fp-accent-text)]">{t("auth.servicesTitle")}</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {[t("auth.service1"), t("auth.service2"), t("auth.service3"), t("auth.service4")].map((service) => (
                  <div key={service} className="rounded-xl border border-fp-success/25 bg-fp-bg/45 px-3 py-2 font-mono text-[11px] text-[var(--fp-text)]">
                    {service}
                  </div>
                ))}
              </div>
            </section>


          </div>

          <section className="lg:sticky lg:top-8">
            <div className="login-auth-shell animate-fadeIn overflow-hidden rounded-[var(--fp-radius)] border border-white/[0.2] bg-gradient-to-b from-fp-bg-card/100 via-fp-bg-elevated/100 to-fp-bg-card/95 shadow-[0_0_38px_rgba(56,189,248,0.26)] backdrop-blur-[30px] [animation-delay:90ms]">
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-1 pt-1" aria-hidden>
                <div className="h-0.5 flex-1 rounded-full bg-gradient-to-r from-transparent via-fp-accent/55 to-transparent" />
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--fp-text-muted)]">{t("auth.title")}</span>
                <div className="h-0.5 flex-1 rounded-full bg-gradient-to-r from-transparent via-fp-success/30 to-transparent" />
              </div>
              <div className="p-6 sm:p-7">
                {/*
                  Mounted here as well as on the landing page: origin is the
                  configured redirect, but a user who reaches /login carrying the
                  same failed fragment must get the same explanation rather than a
                  bare form. Renders null when the fragment held no error.
                */}
                <AuthLinkNotice className="mb-4" />
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fp-accent-text)]">{t("auth.secure")}</p>
                <h2 className="lab-heading mt-1 text-xl">
                  {mode === "login" && t("auth.login")}
                  {mode === "signup" && t("auth.signup")}
                  {mode === "forgot" && t("auth.forgot")}
                  {mode === "reset" && t("auth.reset")}
                </h2>
                <p className="mt-1 text-xs text-[var(--fp-text-muted)]">{t("auth.continue")}</p>

                <form onSubmit={(event) => void onSubmit(event)} className="mt-5 space-y-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--fp-text-muted)]">
                    {t("auth.email")}
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      disabled={mode === "reset"}
                      className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-fp-accent/35"
                    />
                  </label>
                  {mode !== "forgot" && (
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--fp-text-muted)]">
                      {t("auth.password")}
                      <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-fp-accent/35"
                      />
                    </label>
                  )}
                  {mode === "reset" && (
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--fp-text-muted)]">
                      {t("auth.confirmPasswordLabel")}
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-fp-accent/35"
                      />
                    </label>
                  )}

                  {mode === "signup" && (
                    <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-[var(--fp-text-muted)]">
                      <input
                        type="checkbox"
                        checked={privacyAccepted}
                        onChange={(event) => setPrivacyAccepted(event.target.checked)}
                        className="mt-1 h-3.5 w-3.5 rounded border-white/20 bg-[var(--fp-bg-card)] accent-[var(--fp-accent)] focus:ring-fp-accent/40"
                      />
                      <span>
                        {t("auth.privacyPrefix")}
                        <Link
                          to="/privacy"
                          className="font-semibold text-[var(--fp-accent-text)] underline decoration-[var(--fp-border)] underline-offset-2 hover:text-[var(--fp-accent-hover)]"
                        >
                          {t("auth.privacyPolicyLink")}
                        </Link>
                        {t("auth.privacySuffix")}
                      </span>
                    </label>
                  )}

                  {/*
                    `needsConfirmation` keeps this block mounted on its own:
                    clicking Resend clears the error text (to drop a stale
                    cooldown line), and without it the message and the button
                    both vanished the instant the user pressed them.
                  */}
                  {(localError || error || needsConfirmation) && (
                    <div
                      data-slot="login-error"
                      className="rounded-xl border border-fp-danger/35 bg-fp-danger/10 px-3 py-2 text-xs font-semibold text-[var(--fp-danger)]"
                    >
                      <p>{t(localError || error || "auth.emailNotConfirmedTitle")}</p>
                      {/*
                        The resend lives INSIDE the error block, so the fix sits
                        where the problem is stated. Secondary to Log in by
                        design: a text button at the block's own size, full width
                        on mobile so a long Romanian label cannot overflow the
                        card.
                      */}
                      {needsConfirmation && (
                        <>
                          <p className="mt-1 font-medium text-fp-danger/85">
                            {t("auth.emailNotConfirmedBody")}
                          </p>
                          <button
                            type="button"
                            data-slot="login-resend"
                            onClick={() => void onResendConfirmation()}
                            disabled={resending}
                            aria-busy={resending}
                            className="mt-2 inline-flex min-h-[var(--fp-touch)] w-full items-center justify-center rounded-[var(--fp-radius-sm)] border border-fp-danger/45 px-3 text-xs font-bold text-[var(--fp-danger)] transition-colors hover:bg-fp-danger/10 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] sm:w-auto"
                          >
                            {resending ? t("auth.processing") : t("auth.resendConfirmationFromLogin")}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {resendNotice && (
                    <div
                      data-slot="login-resend-sent"
                      role="status"
                      className="rounded-xl border border-fp-success/35 bg-fp-success/10 px-3 py-2 text-xs font-semibold text-[var(--fp-success)]"
                    >
                      {resendNotice}
                    </div>
                  )}
                  {message && (
                    <div className="rounded-xl border border-fp-success/35 bg-fp-success/10 px-3 py-2 text-xs font-semibold text-[var(--fp-success)]">
                      {message}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-xl border border-fp-accent/70 bg-gradient-to-r from-fp-accent/80 via-[var(--fp-accent)] to-fp-success/70 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_24px_rgba(56,189,248,0.5)] transition hover:-translate-y-0.5 hover:from-[var(--fp-accent)] hover:to-[var(--fp-success)] hover:shadow-[0_0_34px_rgba(56,189,248,0.65)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting
                      ? t("auth.processing")
                      : mode === "login"
                        ? t("auth.login")
                        : mode === "signup"
                          ? t("auth.signup")
                          : mode === "forgot"
                            ? t("auth.sendReset")
                            : t("auth.updatePassword")}
                  </button>
                </form>

                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-white/[0.06] pt-4 text-xs font-semibold">
                  {(mode === "login" || mode === "signup") && (
                    <button
                      type="button"
                      onClick={() => {
                        setPrivacyAccepted(false);
                        setMode(mode === "login" ? "signup" : "login");
                      }}
                      className="text-[var(--fp-accent-text)] transition hover:text-[var(--fp-accent-hover)]"
                    >
                      {mode === "login" ? t("auth.noAccount") : t("auth.hasAccount")}
                    </button>
                  )}
                  {mode === "login" && (
                    <button
                      type="button"
                      onClick={() => setMode("forgot")}
                      className="text-fp-warning/90 transition hover:text-[var(--fp-warning)]"
                    >
                      {t("auth.forgotLink")}
                    </button>
                  )}
                  {(mode === "forgot" || mode === "reset") && (
                    <button type="button" onClick={() => setMode("login")} className="text-[var(--fp-accent-text)] transition hover:text-[var(--fp-accent-hover)]">
                      {t("auth.backToLogin")}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <p className="mt-4 text-center text-[11px] text-[var(--fp-text-muted)] lg:text-left">
              <Link
                to="/privacy"
                className="text-[var(--fp-text-muted)] underline decoration-white/15 underline-offset-2 transition hover:text-[var(--fp-accent-text)]"
              >
                {t("auth.privacyFooterLink")}
              </Link>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
