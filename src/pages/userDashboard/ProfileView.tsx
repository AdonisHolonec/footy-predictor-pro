/**
 * Profile view extracted verbatim from UserDashboard.tsx (Sprint 6, step b).
 * Rendering and copy are unchanged; state stays in the page, arrives as props.
 */

import type { Dispatch, SetStateAction } from "react";
import type { AppNavView } from "../../components/ux/appNav";
import PricingCampaignBanner, { PlanCampaignPrice } from "../../components/ux/PricingCampaignBanner";
import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import SectionHeader from "../../design-system/SectionHeader";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
import ReferralCard from "../../components/ux/ReferralCard";
import DisplayNameCard from "../../components/ux/DisplayNameCard";
import type { useAuth } from "../../hooks/useAuth";
import type { useUiPrefs } from "../../hooks/useUiPrefs";
import { openBillingPortal, startCheckout } from "../../services/billingService";

type AuthState = ReturnType<typeof useAuth>;

type ProfileViewProps = {
  user: AuthState["user"];
  userTier: AuthState["userTier"];
  isSubscriptionExpired: AuthState["isSubscriptionExpired"];
  trialRemainingTime: AuthState["trialRemainingTime"];
  tierQuotaExempt: AuthState["tierQuotaExempt"];
  predictCountToday: AuthState["predictCountToday"];
  predictLimitToday: AuthState["predictLimitToday"];
  logout: AuthState["logout"];
  activate24hTrial: AuthState["activate24hTrial"];
  updateFilters: ReturnType<typeof useUiPrefs>["updateFilters"];
  setStatus: Dispatch<SetStateAction<string>>;
  trialBusy: "premium" | "ultra" | null;
  setTrialBusy: Dispatch<SetStateAction<"premium" | "ultra" | null>>;
  billingBusy: "premium" | "ultra" | "portal" | null;
  setBillingBusy: Dispatch<SetStateAction<"premium" | "ultra" | "portal" | null>>;
  billingConfigured: boolean;
  formatRemaining: (ms: number) => string;
  handleNav: (view: AppNavView) => void;
  /** Opens the favourite-leagues drawer (moved here from the global header). */
  onOpenLeagues?: () => void;
  showModelInternals: boolean;
};

export default function ProfileView(props: ProfileViewProps) {
  const {
    user,
    userTier,
    isSubscriptionExpired,
    trialRemainingTime,
    tierQuotaExempt,
    predictCountToday,
    predictLimitToday,
    logout,
    activate24hTrial,
    updateFilters,
    setStatus,
    trialBusy,
    setTrialBusy,
    billingBusy,
    setBillingBusy,
    billingConfigured,
    formatRemaining,
    handleNav,
    onOpenLeagues,
    showModelInternals
  } = props;
  const { t, locale, setLocale } = useLocale();
  return (
        <section className="space-y-6">
          <header>
            <SectionHeader as="h1" size="page" eyebrow={t("nav.account")} title={t("nav.account")} />
          </header>

          <div className="flex items-center gap-3.5 rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 shadow-fp-sm">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[var(--fp-radius)] bg-[var(--fp-accent)] font-display text-xl font-bold text-white">
              {(user?.email?.[0] || "?").toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-base font-bold text-[var(--fp-text)]">{user?.email}</p>
              <Badge tone="accent" className="mt-1.5">
                {userTier}
              </Badge>
            </div>
          </div>

          {!tierQuotaExempt && predictLimitToday != null && (
            <div className="rounded-[var(--fp-radius-lg)] bg-[var(--fp-accent)] p-4 text-white shadow-fp-sm">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-85">{t("dash.dailyQuota")}</p>
              <p className="mt-1.5 font-display text-3xl font-bold tracking-tight">
                {predictCountToday}
                <span className="text-base font-semibold opacity-70"> / {predictLimitToday} {t("dash.quotaCallsSuffix")}</span>
              </p>
              <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-white/25">
                <div
                  className="h-full rounded-full bg-white"
                  style={{ width: `${Math.max(0, Math.min(100, (predictCountToday / predictLimitToday) * 100))}%` }}
                />
              </div>
            </div>
          )}

          {!tierQuotaExempt && (
            <Card id="upgrade" className="scroll-mt-28">
              <h2 className="font-display text-[length:var(--fp-section)] font-semibold">{t("dash.subscription")}</h2>
              <p className="mt-1 text-sm text-[var(--fp-text-muted)]">{t("dash.subscriptionSub")}</p>
              {isSubscriptionExpired && (
                <div className="mt-3 flex items-center gap-2 rounded-[var(--fp-radius-sm)] border border-fp-danger/35 bg-fp-danger/10 px-3 py-2.5">
                  <span className="text-base" aria-hidden>
                    ⚠️
                  </span>
                  <p className="text-sm font-semibold text-[var(--fp-danger)]">{t("dash.subscriptionExpired")}</p>
                </div>
              )}
              <PricingCampaignBanner className="mt-3" />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">Premium</p>
                  <PlanCampaignPrice tier="premium" />
                </div>
                <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">Ultra</p>
                  <PlanCampaignPrice tier="ultra" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  disabled={!billingConfigured || billingBusy !== null}
                  loading={billingBusy === "premium"}
                  onClick={async () => {
                    setBillingBusy("premium");
                    try {
                      window.location.href = await startCheckout("premium");
                    } catch (e: unknown) {
                      setStatus(e instanceof Error ? e.message : "Checkout Premium eșuat.");
                      setBillingBusy(null);
                    }
                  }}
                >
                  {t("pricing.subscribePremium")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!billingConfigured || billingBusy !== null}
                  loading={billingBusy === "ultra"}
                  onClick={async () => {
                    setBillingBusy("ultra");
                    try {
                      window.location.href = await startCheckout("ultra");
                    } catch (e: unknown) {
                      setStatus(e instanceof Error ? e.message : "Checkout Ultra eșuat.");
                      setBillingBusy(null);
                    }
                  }}
                >
                  {t("pricing.subscribeUltra")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!billingConfigured || billingBusy !== null}
                  loading={billingBusy === "portal"}
                  onClick={async () => {
                    setBillingBusy("portal");
                    try {
                      window.location.href = await openBillingPortal();
                    } catch (e: unknown) {
                      setStatus(e instanceof Error ? e.message : "Portal billing eșuat.");
                      setBillingBusy(null);
                    }
                  }}
                >
                  {t("dash.manageBilling")}
                </Button>
              </div>
              {!billingConfigured && (
                <p className="mt-3 text-xs text-[var(--fp-text-muted)]">{t("dash.stripeMissing")}</p>
              )}
            </Card>
          )}

          {!tierQuotaExempt && (
            <Card>
              <h2 className="font-display text-[length:var(--fp-section)] font-semibold">{t("dash.trial24h")}</h2>
              <p className="mt-1 text-sm text-[var(--fp-text-muted)]">{t("dash.trial24hSub")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={trialBusy !== null || !!user?.premium_trial_activated_at || trialRemainingTime.ultraMs > 0}
                  loading={trialBusy === "premium"}
                  onClick={async () => {
                    setTrialBusy("premium");
                    try {
                      await activate24hTrial("premium");
                      setStatus("Trial Premium activat pentru 24h.");
                    } catch (e: unknown) {
                      setStatus(e instanceof Error ? e.message : "Nu am putut activa trial Premium.");
                    } finally {
                      setTrialBusy(null);
                    }
                  }}
                >
                  {user?.premium_trial_activated_at
                    ? t("dash.trialPremiumUsed")
                    : trialRemainingTime.ultraMs > 0
                      ? t("dash.trialUltraActive")
                      : t("dash.trialActivatePremium")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={trialBusy !== null || !!user?.ultra_trial_activated_at || trialRemainingTime.premiumMs > 0}
                  loading={trialBusy === "ultra"}
                  onClick={async () => {
                    setTrialBusy("ultra");
                    try {
                      await activate24hTrial("ultra");
                      setStatus("Trial Ultra activat pentru 24h.");
                    } catch (e: unknown) {
                      setStatus(e instanceof Error ? e.message : "Nu am putut activa trial Ultra.");
                    } finally {
                      setTrialBusy(null);
                    }
                  }}
                >
                  {user?.ultra_trial_activated_at
                    ? t("dash.trialUltraUsed")
                    : trialRemainingTime.premiumMs > 0
                      ? t("dash.trialPremiumActive")
                      : t("dash.trialActivateUltra")}
                </Button>
              </div>
              {(trialRemainingTime.premiumMs > 0 || trialRemainingTime.ultraMs > 0) && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {trialRemainingTime.premiumMs > 0 && (
                    <Badge tone="accent">
                      {t("dash.trialPremiumActive")}: {formatRemaining(trialRemainingTime.premiumMs)}
                    </Badge>
                  )}
                  {trialRemainingTime.ultraMs > 0 && (
                    <Badge tone="warning">
                      {t("dash.trialUltraActive")}: {formatRemaining(trialRemainingTime.ultraMs)}
                    </Badge>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* PR3d2: between billing and preferences — referral is an account concern
              adjacent to plan and bonus time, not a workspace feature. */}
          {/* Immediately above the referral card: the name is only meaningful
              because of referrals, and this is where a user goes looking for it. */}
          <DisplayNameCard userId={user?.id ?? null} />

          <ReferralCard userId={user?.id ?? null} />

          <Card className="space-y-3" data-testid="account-preferences">
            <SectionHeader as="h2" size="section" title={t("account.preferencesTitle")} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-[var(--fp-text)]">{t("shell.switchLang")}</span>
              <div className="inline-flex h-11 overflow-hidden rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)]" role="group" aria-label={t("shell.switchLang")}>
                {(["ro", "en"] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLocale(code)}
                    aria-pressed={locale === code}
                    className={`min-w-11 px-3 text-xs font-bold ${
                      locale === code ? "bg-[var(--fp-accent)] text-white" : "bg-[var(--fp-bg-card)] text-[var(--fp-text-muted)]"
                    }`}
                  >
                    {code === "ro" ? t("shell.langRo") : t("shell.langEn")}
                  </button>
                ))}
              </div>
            </div>
            {onOpenLeagues && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[var(--fp-text)]">{t("shell.leagues")}</span>
                <Button size="sm" variant="secondary" onClick={onOpenLeagues} className="touch-target">
                  {t("shell.filterLeagues")}
                </Button>
              </div>
            )}
            <label className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--fp-text)]">{t("account.modelInternals")}</span>
                <span className="block text-xs text-[var(--fp-text-muted)]">{t("account.modelInternalsSub")}</span>
              </span>
              <input
                type="checkbox"
                data-testid="model-internals-toggle"
                checked={showModelInternals}
                onChange={(e) => updateFilters({ showModelInternals: e.target.checked })}
                className="h-5 w-5 shrink-0 accent-[var(--fp-accent)]"
              />
            </label>
          </Card>

          <div className="overflow-hidden rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)]">
            {!tierQuotaExempt && (
              <button
                type="button"
                onClick={() => document.getElementById("upgrade")?.scrollIntoView({ behavior: "smooth" })}
                className="flex w-full items-center gap-3 border-b border-[var(--fp-border)] px-4 py-3.5 text-left transition-colors hover:bg-[var(--fp-bg-muted)]"
              >
                <span className="text-[var(--fp-accent)]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="1" y="4" width="22" height="16" rx="2" />
                    <line x1="1" y1="10" x2="23" y2="10" />
                  </svg>
                </span>
                <span className="text-sm font-bold text-[var(--fp-text)]">{t("dash.subscription")}</span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="ml-auto text-[var(--fp-text-faint)]"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                handleNav("matches");
              }}
              className="flex w-full items-center gap-3 border-b border-[var(--fp-border)] px-4 py-3.5 text-left transition-colors hover:bg-[var(--fp-bg-muted)]"
            >
              <span className="text-[var(--fp-accent)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              <span className="text-sm font-bold text-[var(--fp-text)]">{t("dash.watchlist")}</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="ml-auto text-[var(--fp-text-faint)]"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleNav("statistics")}
              className="flex w-full items-center gap-3 border-b border-[var(--fp-border)] px-4 py-3.5 text-left transition-colors hover:bg-[var(--fp-bg-muted)]"
            >
              <span className="text-[var(--fp-accent)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="20" x2="12" y2="10" />
                  <line x1="18" y1="20" x2="18" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="16" />
                </svg>
              </span>
              <span className="text-sm font-bold text-[var(--fp-text)]">{t("nav.statistics")}</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="ml-auto text-[var(--fp-text-faint)]"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleNav("notifications")}
              className="flex w-full items-center gap-3 border-b border-[var(--fp-border)] px-4 py-3.5 text-left transition-colors hover:bg-[var(--fp-bg-muted)]"
            >
              <span className="text-[var(--fp-accent)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </span>
              <span className="text-sm font-bold text-[var(--fp-text)]">{t("nav.notifications")}</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="ml-auto text-[var(--fp-text-faint)]"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleNav("settings")}
              className="flex w-full items-center gap-3 border-b border-[var(--fp-border)] px-4 py-3.5 text-left transition-colors hover:bg-[var(--fp-bg-muted)]"
            >
              <span className="text-[var(--fp-accent)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </svg>
              </span>
              <span className="text-sm font-bold text-[var(--fp-text)]">{t("nav.settings")}</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="ml-auto text-[var(--fp-text-faint)]"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--fp-bg-muted)]"
            >
              <span className="text-[var(--fp-danger)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M16 17l5-5-5-5M21 12H9" />
                </svg>
              </span>
              <span className="text-sm font-bold text-[var(--fp-danger)]">{t("dash.logout")}</span>
            </button>
          </div>
        </section>
  );
}