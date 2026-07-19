import { Link } from "react-router-dom";
import PricingCampaignBanner, { PlanCampaignPrice } from "../components/ux/PricingCampaignBanner";
import { BRAND_IMAGES } from "../constants/brandAssets";
import { PRICING_CAMPAIGN } from "../constants/pricingCampaign";
import { useLocale } from "../context/LocaleContext";
import Badge from "../design-system/Badge";
import Card from "../design-system/Card";
import { useAuth } from "../hooks/useAuth";

export default function LandingAccess() {
  const { t, locale, setLocale } = useLocale();
  const { user, loading } = useAuth();

  const workspace = "/workspace";
  const login = "/login";
  const signup = "/login?mode=signup";

  const langBtn = (code: "ro" | "en") =>
    `min-w-9 px-2 text-[11px] font-bold ${
      locale === code ? "bg-[var(--fp-accent)] text-white" : "bg-[var(--fp-bg-card)] text-[var(--fp-text-muted)]"
    }`;

  const linkPrimary =
    "inline-flex min-h-[var(--fp-touch)] items-center justify-center rounded-[var(--fp-radius-sm)] bg-[var(--fp-accent)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--fp-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]";
  const linkSecondary =
    "inline-flex min-h-[var(--fp-touch)] items-center justify-center rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-4 text-sm font-semibold text-[var(--fp-text)] transition-colors hover:border-[var(--fp-border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]";

  return (
    <div className="min-h-screen bg-[var(--fp-bg)] text-[var(--fp-text)]">
      <header className="sticky top-0 z-40 border-b border-[var(--fp-border)] bg-[var(--fp-bg-card)]/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-3 sm:px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2.5">
            <img
              src={BRAND_IMAGES.logoPrimary}
              alt=""
              className="h-9 w-9 shrink-0 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] object-contain p-0.5"
            />
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold tracking-tight">{t("landing.brand")}</p>
              <p className="truncate text-[10px] font-medium text-[var(--fp-text-muted)]">{t("landing.brandSub")}</p>
            </div>
          </Link>

          <div className="flex shrink-0 items-center gap-2">
            <div
              className="inline-flex h-9 overflow-hidden rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)]"
              role="group"
              aria-label={t("shell.switchLang")}
            >
              <button type="button" className={langBtn("ro")} onClick={() => setLocale("ro")}>
                {t("shell.langRo")}
              </button>
              <button type="button" className={langBtn("en")} onClick={() => setLocale("en")}>
                {t("shell.langEn")}
              </button>
            </div>
            <Link to={user ? workspace : login} className={`${linkSecondary} !min-h-9 px-3 text-xs`}>
              {user ? t("landing.openApp") : t("landing.login")}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-3 py-6 sm:px-4 sm:py-8">
        {/* Hero */}
        <section className="text-center sm:text-left">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--fp-accent)]">{t("landing.brand")}</p>
          <h1 className="mt-2 font-display text-[length:var(--fp-hero)] font-semibold leading-tight tracking-tight">
            {t("landing.headline")}
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm font-medium leading-relaxed text-[var(--fp-text-muted)] sm:mx-0">
            {t("landing.sub")}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {user ? (
              <Link to={workspace} className={linkPrimary}>
                {t("landing.ctaWorkspace")}
              </Link>
            ) : (
              <Link to={signup} className={linkPrimary}>
                {t("landing.ctaStart")}
              </Link>
            )}
            <a href="#pricing" className={linkSecondary}>
              {t("landing.ctaPlans")}
            </a>
          </div>
        </section>

        {/* Preview + benefits */}
        <section className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <Card padding="sm" className="border-[var(--fp-accent)]/25 shadow-[var(--fp-shadow)]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
                {t("landing.previewEyebrow")}
              </p>
              <span className="font-mono text-[11px] tabular-nums text-[var(--fp-text-faint)]">{t("landing.previewTime")}</span>
            </div>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-accent)]">
              {t("landing.previewLeague")}
            </p>
            <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[var(--fp-bg-muted)] text-xs font-bold text-[var(--fp-accent)]">
                  LIV
                </div>
                <p className="mt-1 text-sm font-semibold">{t("landing.previewHome")}</p>
              </div>
              <span className="text-[10px] font-bold uppercase text-[var(--fp-text-faint)]">{t("common.vs")}</span>
              <div className="text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[var(--fp-bg-muted)] text-xs font-bold text-[var(--fp-warning)]">
                  TOT
                </div>
                <p className="mt-1 text-sm font-semibold">{t("landing.previewAway")}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1 border-t border-[var(--fp-border)] pt-2">
              {[
                { label: t("card.prediction"), value: t("landing.previewPick"), accent: true },
                { label: t("card.confidence"), value: "79%" },
                { label: t("card.odds"), value: "1.85" },
                { label: t("card.value"), value: "+4.2%" }
              ].map((m) => (
                <div key={m.label} className="min-w-0 px-0.5 text-center">
                  <p className="truncate text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">{m.label}</p>
                  <p
                    className={`mt-0.5 truncate font-display text-sm font-bold tabular-nums ${
                      m.accent ? "text-[var(--fp-accent)]" : "text-[var(--fp-text)]"
                    }`}
                  >
                    {m.value}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {[t("landing.benefitMarkets"), t("landing.benefitValue"), t("landing.benefitHistory")].map((label) => (
              <Card key={label} padding="sm" className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--fp-radius-sm)] bg-[var(--fp-accent-muted)] text-sm font-bold text-[var(--fp-accent)]">
                  ✓
                </span>
                <p className="text-sm font-semibold text-[var(--fp-text)]">{label}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-20 space-y-3">
          <header>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--fp-accent)]">{t("landing.pricingTitle")}</p>
            <h2 className="mt-1 font-display text-[length:var(--fp-section)] font-semibold">{t("landing.pricingTitle")}</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--fp-text-muted)]">{t("landing.pricingSub")}</p>
          </header>

          {PRICING_CAMPAIGN.active ? <PricingCampaignBanner /> : null}

          <div className="grid gap-2 sm:grid-cols-3">
            <Card padding="sm" className="flex h-full flex-col">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">{t("landing.freeTitle")}</p>
              <p className="mt-1 font-display text-2xl font-bold">{t("landing.freePrice")}</p>
              <p className="mt-1 text-xs text-[var(--fp-text-muted)]">{t("landing.freeDesc")}</p>
              <ul className="mt-3 space-y-1 text-xs font-medium text-[var(--fp-text)]">
                <li>{t("landing.freeM1")}</li>
                <li>{t("landing.freeM2")}</li>
                <li>{t("landing.freeM3")}</li>
              </ul>
              <div className="mt-auto pt-3">
                <Link to={signup} className={`${linkSecondary} !min-h-9 w-full text-xs`}>
                  {t("landing.freeCta")}
                </Link>
              </div>
            </Card>

            <Card
              padding="sm"
              className="relative flex h-full flex-col border-[var(--fp-warning)]/45 ring-1 ring-[var(--fp-warning)]/25"
            >
              {PRICING_CAMPAIGN.active ? (
                <Badge tone="warning" className="absolute right-2 top-2">
                  −{PRICING_CAMPAIGN.discountPercent}%
                </Badge>
              ) : null}
              <p className="pr-14 text-[10px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">
                {t("landing.premiumTitle")}
              </p>
              <PlanCampaignPrice tier="premium" />
              <p className="mt-1 text-xs text-[var(--fp-text-muted)]">{t("landing.premiumDesc")}</p>
              <ul className="mt-3 space-y-1 text-xs font-medium text-[var(--fp-text)]">
                <li>{t("landing.premiumM1")}</li>
                <li>{t("landing.premiumM2")}</li>
                <li>{t("landing.premiumM3")}</li>
              </ul>
              <div className="mt-auto pt-3">
                <Link
                  to={`${login}?from=pricing&tier=premium`}
                  className={`${linkPrimary} !min-h-9 w-full text-xs`}
                >
                  {PRICING_CAMPAIGN.active ? t("pricing.subscribePremium") : t("landing.premiumTitle")}
                </Link>
              </div>
            </Card>

            <Card padding="sm" className="relative flex h-full flex-col">
              {PRICING_CAMPAIGN.active ? (
                <Badge tone="warning" className="absolute right-2 top-2">
                  −{PRICING_CAMPAIGN.discountPercent}%
                </Badge>
              ) : null}
              <p className="pr-14 text-[10px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">
                {t("landing.ultraTitle")}
              </p>
              <PlanCampaignPrice tier="ultra" />
              <p className="mt-1 text-xs text-[var(--fp-text-muted)]">{t("landing.ultraDesc")}</p>
              <ul className="mt-3 space-y-1 text-xs font-medium text-[var(--fp-text)]">
                <li>{t("landing.ultraM1")}</li>
                <li>{t("landing.ultraM2")}</li>
                <li>{t("landing.ultraM3")}</li>
              </ul>
              <div className="mt-auto pt-3">
                <Link
                  to={`${login}?from=pricing&tier=ultra`}
                  className={`${linkSecondary} !min-h-9 w-full text-xs`}
                >
                  {PRICING_CAMPAIGN.active ? t("pricing.subscribeUltra") : t("landing.ultraTitle")}
                </Link>
              </div>
            </Card>
          </div>
        </section>

        {/* Final CTA */}
        <Card padding="sm" className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-semibold">{t("landing.finalTitle")}</h3>
            <p className="mt-0.5 text-sm text-[var(--fp-text-muted)]">{t("landing.finalSub")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={user ? workspace : signup} className={`${linkPrimary} !min-h-9 text-xs`}>
              {user ? t("landing.openApp") : t("landing.finalCta")}
            </Link>
            {!user ? (
              <Link to={login} className={`${linkSecondary} !min-h-9 text-xs`}>
                {t("landing.login")}
              </Link>
            ) : null}
          </div>
        </Card>

        <footer className="flex flex-col gap-3 border-t border-[var(--fp-border)] py-4 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <p className="text-xs text-[var(--fp-text-muted)]">
            {loading
              ? t("landing.sessionLoading")
              : user
                ? t("landing.sessionActive", { email: user.email || "" })
                : t("landing.sessionGuest")}
          </p>
          <div className="flex flex-wrap justify-center gap-4 sm:justify-end">
            <Link to="/track-record" className="text-xs font-semibold text-[var(--fp-accent)] hover:underline">
              {t("landing.trackRecord")}
            </Link>
            <Link to="/privacy" className="text-xs font-semibold text-[var(--fp-accent)] hover:underline">
              {t("landing.privacy")}
            </Link>
            <Link to={login} className="text-xs font-semibold text-[var(--fp-accent)] hover:underline">
              {t("landing.login")}
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
