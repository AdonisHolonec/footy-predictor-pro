import { AdminObservatoryHeader, AdminToolbarStrip } from "./components/admin/AdminObservatory";
import Auth from "./components/Auth";
import Footer from "./components/layout/Footer";
import GuestBody from "./components/layout/GuestBody";
import GuestHeaderControls from "./components/layout/GuestHeaderControls";
import Header from "./components/layout/Header";
import ObservatoryBody from "./components/layout/ObservatoryBody";
import ApiStatus from "./components/panels/ApiStatus";
import StatisticsPanel from "./components/panels/StatisticsPanel";
import PerformanceCounterModal from "./components/PerformanceCounterModal";
import MatchModal from "./components/MatchModal";
import SuccessRateTracker from "./components/SuccessRateTracker";
import { BRAND_IMAGES } from "./constants/brandAssets";
import { useAppController } from "./hooks/useAppController";
import { hashColor, isoToday, normalizeSelectedDates } from "./utils/appUtils";

export default function App() {
  const c = useAppController();

  return (
    <div className="lab-page relative min-h-screen font-sans">
      <div className="lab-bg" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-cover bg-center opacity-[0.035]"
        style={{ backgroundImage: `url(${c.observatoryShell ? BRAND_IMAGES.adminObservatoryRef : BRAND_IMAGES.refDashboard})` }}
        aria-hidden
      />
      <div className="relative z-10 mx-auto max-w-[1680px] px-3 py-5 sm:px-5 sm:py-7 lg:px-8 lg:py-8">
        {c.observatoryShell ? (
          <>
            <AdminObservatoryHeader
              editorialDate={c.editorialDateLine}
              modelPulse={c.modelPulse}
              user={c.user ? { email: c.user.email, role: c.user.role } : null}
              authLoading={c.authLoading}
              onOpenAuth={() => c.setIsAuthOpen(true)}
              onLogout={c.actions.handleLogout}
            />
            <AdminToolbarStrip
              date={c.date}
              setDate={c.setDate}
              selectedDates={c.selectedDates}
              setSelectedDates={c.setSelectedDates}
              normalizeSelectedDates={normalizeSelectedDates}
              isoToday={isoToday}
              usageCount={c.calls.usageCount}
              usageLimit={c.calls.usageLimit}
              usagePct={c.calls.usagePct}
              user={c.user}
              onWarm={c.warm}
              onPredict={c.predict}
              setStatus={c.setStatus}
            />
          </>
        ) : (
          <Header
            date={c.date}
            modelPulse={c.modelPulse}
            childrenRight={
              <GuestHeaderControls
                usageCount={c.calls.usageCount}
                usageLimit={c.calls.usageLimit}
                usagePct={c.calls.usagePct}
                authLoading={c.authLoading}
                user={c.user}
                onLogout={c.actions.handleLogout}
                onOpenAuth={() => c.setIsAuthOpen(true)}
                date={c.date}
                setDate={c.setDate}
                selectedDates={c.selectedDates}
                setSelectedDates={c.setSelectedDates}
                setStatus={c.setStatus}
                onWarm={c.warm}
                onPredict={c.predict}
              />
            }
          >
            <SuccessRateTracker {...c.trackerProps} />
            <StatisticsPanel {...c.statisticsProps} />
          </Header>
        )}

        <ApiStatus status={c.status} />

        {c.observatoryShell ? (
          <ObservatoryBody
            {...c.sharedListProps}
            trackerProps={c.trackerProps}
            statisticsProps={c.statisticsProps}
            usageCount={c.calls.usageCount}
            usageLimit={c.calls.usageLimit}
            usagePct={c.calls.usagePct}
            usageSnapshot={c.calls.usageSnapshot}
            onLoadUsage={() => void c.calls.loadUsageSnapshot()}
            accessToken={c.session?.access_token}
            isAdmin={c.user?.role === "admin"}
            kickoffScope={c.predictions.kickoffScope}
            setKickoffScope={c.predictions.setKickoffScope}
            minXgSpread={c.predictions.minXgSpread}
            setMinXgSpread={c.predictions.setMinXgSpread}
            insightSample={c.predictions.insightSample}
            managedProfiles={c.managedProfiles}
            isAdminWorking={c.actions.isAdminWorking}
            onRefreshProfiles={() => void c.refreshManagedProfiles()}
            usageLoading={c.calls.usageLoading}
            perfAdminSnapshot={c.perfAdminSnapshot}
            perfAdminLoading={c.perfAdminLoading}
            onLoadPerfAdmin={() => void c.loadPerfAdmin()}
            adminTierDraftByUser={c.adminTierDraftByUser}
            setAdminTierDraftByUser={c.setAdminTierDraftByUser}
            adminExpiryDraftByUser={c.adminExpiryDraftByUser}
            setAdminExpiryDraftByUser={c.setAdminExpiryDraftByUser}
            onRoleChange={c.actions.handleAdminRoleChange}
            onToggleBlock={c.actions.handleAdminToggleBlock}
            onMonetizationSave={c.actions.handleAdminMonetizationSave}
          />
        ) : (
          <GuestBody {...c.sharedListProps} />
        )}
      </div>

      <Footer
        onPredict={c.predict}
        disabled={!c.user || !c.leagues.selectedLeagueIds.length}
        selectedLeagueCount={c.leagues.selectedLeagueIds.length}
      />

      {c.predictions.selectedMatch && (
        <MatchModal
          match={c.predictions.selectedMatch}
          logoColors={c.predictions.logoColors}
          hashColor={hashColor}
          canShowSpecialBet={c.user?.role === "admin" || c.user?.tier === "ultra"}
          accessTier={c.user?.tier || "free"}
          onClose={() => c.predictions.setSelectedMatch(null)}
        />
      )}
      <PerformanceCounterModal
        open={c.perfCounterModalOpen}
        onClose={() => c.setPerfCounterModalOpen(false)}
        days={30}
        globalByLeague={c.tracker.globalPerformanceByLeague}
        accessToken={c.session?.access_token ?? null}
        isAdmin={c.user?.role === "admin"}
      />
      <Auth
        isOpen={c.isAuthOpen}
        onClose={() => c.setIsAuthOpen(false)}
        onLogin={c.actions.handleLogin}
        onSignup={c.actions.handleSignup}
        onForgotPassword={c.actions.handleForgotPassword}
        onUpdatePassword={c.actions.handleUpdatePassword}
        isSubmitting={c.actions.isAuthSubmitting}
        authError={c.authError}
      />
    </div>
  );
}
