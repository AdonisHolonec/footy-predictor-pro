/**
 * SettingsView extracted verbatim from UserDashboard.tsx (Sprint 6, step c).
 * Rendering and copy are unchanged; state stays in the page, arrives as props.
 */

import { Link } from "react-router-dom";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
import SupportEntry from "../../components/support/SupportEntry";
import type { useAuth } from "../../hooks/useAuth";
import type { useUiPrefs } from "../../hooks/useUiPrefs";

type UiPrefs = ReturnType<typeof useUiPrefs>;

type SettingsViewProps = {
  prefs: UiPrefs["prefs"];
  updateFilters: UiPrefs["updateFilters"];
  logout: ReturnType<typeof useAuth>["logout"];
  cycleTheme: () => void;
  downloadPersonalDataExport: () => void;
  exportBusy: boolean;
  /** Raised with an i18n key when a support or feedback submission succeeds. */
  onSupportSubmitted?: (messageKey: string) => void;
};

export default function SettingsView(props: SettingsViewProps) {
  const {
    prefs,
    updateFilters,
    logout,
    cycleTheme,
    downloadPersonalDataExport,
    exportBusy,
    onSupportSubmitted
  } = props;
  const { t } = useLocale();
  return (
        <section className="space-y-6">
          <header>
            <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-[0.2em] text-[var(--fp-accent)]">
              {t("dash.settingsTitle")}
            </p>
            <h1 className="mt-1 font-display text-[length:var(--fp-hero)] font-semibold">{t("dash.settingsTitle")}</h1>
            <p className="mt-2 text-sm text-[var(--fp-text-muted)]">{t("dash.settingsSub")}</p>
          </header>

          <Card>
            <h2 className="font-display text-[length:var(--fp-section)] font-semibold">{t("dash.appearance")}</h2>
            <p className="mt-1 text-sm text-[var(--fp-text-muted)]">
              {t("dash.currentTheme", { theme: prefs.theme })}
            </p>
            <Button className="mt-3" variant="secondary" onClick={cycleTheme}>
              {t("dash.changeTheme")}
            </Button>
          </Card>

          <Card>
            <h2 className="font-display text-[length:var(--fp-section)] font-semibold">{t("dash.savedFilters")}</h2>
            <p className="mt-1 text-sm text-[var(--fp-text-muted)]">
              Confidence ≥ {prefs.minConfidence}% · EV ≥ {prefs.minEv}% · Best Value only:{" "}
              {prefs.valueOnly ? t("dash.on") : t("dash.off")} · Settled:{" "}
              {prefs.settledOnly ? t("dash.on") : t("dash.off")}
            </p>
            <p className="mt-2 text-xs text-[var(--fp-text-faint)]">{t("dash.savedFiltersSub")}</p>
            <Button
              className="mt-3"
              variant="ghost"
              size="sm"
              onClick={() =>
                updateFilters({
                  minConfidence: 0,
                  minEv: 0,
                  valueOnly: false,
                  settledOnly: false,
                  matchSearch: "",
                  matchesFilter: "all"
                })
              }
            >
              {t("dash.resetFilters")}
            </Button>
          </Card>

          <Card>
            <h2 className="font-display text-[length:var(--fp-section)] font-semibold">{t("dash.gdprTitle")}</h2>
            <p className="mt-1 text-sm text-[var(--fp-text-muted)]">
              {t("dash.gdprSub")} —{" "}
              <Link to="/privacy" className="text-[var(--fp-accent)] underline">
                {t("dash.privacyPolicy")}
              </Link>
              .
            </p>
            <Button className="mt-3" variant="secondary" loading={exportBusy} onClick={() => void downloadPersonalDataExport()}>
              {t("dash.downloadExport")}
            </Button>
          </Card>

          {/* One component, mounted by both authenticated trees — see SupportEntry. */}
          <SupportEntry onSubmitted={onSupportSubmitted} />

          <Card>
            <Button variant="danger" onClick={() => void logout()}>
              {t("dash.logout")}
            </Button>
          </Card>
        </section>
  );
}