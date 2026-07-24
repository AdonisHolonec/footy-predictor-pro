# Graph Report - footy-predictor-starter  (2026-07-24)

## Corpus Check
- 451 files · ~303,146 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3122 nodes · 7724 edges · 199 communities (188 shown, 11 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 197 edges (avg confidence: 0.52)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d0e8ebfa`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- healthBundle.js
- AdminObservatory.tsx
- Stage03LambdaGeneration.js
- ml/index.js
- ContextEngine.js
- FeatureImportanceEngine.js
- runFixtureStageLoop.js
- Module reference
- EnterpriseDashboard.tsx
- LandingAccess.tsx
- ValueEngine.js
- src/types.ts
- BacktestAnalytics.js
- useAppController.ts
- daily-ml.js
- confidence/ConfidenceEngine.js
- UserDashboard.tsx
- Stage07ModelFusion.js
- Stage02FeatureCollection.js
- rebuildTeamMarketRolling.js
- LocaleContext.tsx
- Stage01DataCollection.js
- MatchModal.tsx
- LeagueProfile.js
- PerformancePanel.tsx
- history.js
- CalibrationSelector.js
- useBacktest.ts
- admin.js
- devDependencies
- useLocale
- fitStacker.js
- getSupabaseAdmin
- fixtures.js
- Stage05Simulation.js
- PredictionEngine/types.ts
- specialBet.ts
- PredictionFocusCard.tsx
- predictionLaboratory.ts
- billing.js
- math.test.js
- compilerOptions
- result
- cardMarketSettlement.js
- Stage04ProbabilityGeneration.js
- PredictionLaboratory.js
- Dimension Notes (audit detail)
- design-system/index.ts
- TipEvent.js
- overlayStore.js
- dependencies
- helpers.js
- scripts
- ModelLab.js
- usePerformanceTracker.ts
- PoissonEngine.js
- Enterprise Audit Report — Footy Predictor Pro
- HomeSection.tsx
- clamp
- User Experience V3
- ConfidenceEnginePanel.tsx
- isAuthorizedCronOrInternalRequest
- PredictionExplanation.js
- isotonicCalibration.js
- 4. Section specs
- exclude
- api/backtest.js
- MatchCard.tsx
- useKickoffWeather.ts
- Feature Roadmap UI — Placeholders & Integration (No Backend Changes)
- API Optimization Report
- TrackRecordSection.tsx
- backtestContextEngine.mjs
- ValueCard.tsx
- MonteCarloEngine.js
- goldenFixture.test.js
- vercel.json
- overrides
- rebuildElo.js
- package.json
- ModelInterface.ts
- AdminUsersTable.tsx
- record-golden-fixture.mjs
- ConfidenceEngine.ts
- PredictionContext
- H2HEngine.js
- HomeAdvantage.ts
- neutral
- OddsEngine.js
- RecommendationEngine.ts
- RefereeEngine.js
- 4.3 Stage specifications
- WeatherEngine.js
- GuestHeaderControls.tsx
- PRODUCTION CERTIFICATION REPORT
- TodayOverview.tsx
- scripts/backtest.js
- extractGoldenSnapshot.js
- PredictionReason.d.ts
- LeagueProfile.d.ts
- Component Library V3
- Predictor V2 — Integration Report
- vite-env.d.ts
- eslint
- UI / UX Masterplan — Footy Predictor Pro V3
- SignalLab.tsx
- fetcher.js
- typescript-eslint
- @vitejs/plugin-react
- confidenceWeights.d.ts
- warm-predict.js
- ML Ready — Footy Predictor
- AutoCalibrationEngine.js
- useWarm.ts
- Frontend App Architecture Refactor
- Probability Calibration Report
- Prediction Engine Execution Report
- Predictor V3 Foundation Report
- USER_UI_AUDIT.md
- metricsStore.js
- ENTERPRISE UI V2 REPORT
- UI_COMPONENT_INVENTORY.md
- USER_NAVIGATION_MAP.md
- UpgradePrompt.tsx
- BUTTON_VALIDATION_REPORT.md
- [Implemented] 2026-07-19 — UX V4 foundation + IA + Home
- 1. Prediction Contributions Engine (signed)
- Expected Goals (xG) Engine Report
- closingOddsCapture.js
- Prediction Engine Activation Report
- DESIGN_SYSTEM.md
- FINAL_ENTERPRISE_AUDIT_2026.md
- Auto Model Selection
- PRODUCTION_P0_PLAN.md
- confidenceWeights.js
- getWithCache
- User UI Complete Redesign Plan
- UX_IMPROVEMENTS.md
- Value Betting Engine
- ACCESSIBILITY_REPORT.md
- Professional Quantitative Backtest Engine
- Model Laboratory
- Monte Carlo Adaptive Simulations Report
- PERFORMANCE_REPORT.md
- REGRESSION_REPORT.md
- RESPONSIVE_REPORT.md
- PredictionEngine/index.js
- publicBaseUrl.js
- Required modifications
- Required modifications
- PredictionContributions.js
- Context Engine — Historical Backtest
- 1.2 Module inventory (live)
- STEP 3 — Structural Findings
- manualLocks.js
- overlayRuntime.js
- PREDICTOR_V3_ARCHITECTURE.md
- 5.3 Migration strategy
- 1. Executive Summary
- 25. Top 100 Remaining Improvements
- 27. CTO Final Verdict
- 3. AI & Prediction Engine Review
- League Profiles
- STEP 5 — Architecture Package
- 11. Complete affected file list
- Required modifications
- Required modifications
- Required modifications
- ExpectedGoals.ts
- 2. Architecture Review
- STEP 2 — Dependency Graphs
- STEP 4 — Predictor V3 Design
- Footy Predictor UI
- 13. Security Review
- 16. Frontend Review
- 17. UX Review
- 4. Quantitative Validation
- 5. Statistical Validation
- 9. TASK 8 — CI
- 10. Ensemble Validation
- 11. API Review
- 12. Database Review
- 14. Performance Review
- 15. Cache Review
- 18. DevOps Review
- 19. Monitoring Review
- 20. CI/CD Review
- 26. Roadmap v3.0
- 6. Explainability Review
- 8. Monte Carlo Validation
- 9. Calibration Validation
- @types/node
- typescript
- vite

## God Nodes (most connected - your core abstractions)
1. `getSupabaseAdmin()` - 94 edges
2. `useLocale()` - 66 edges
3. `getWithCache()` - 49 edges
4. `result()` - 41 edges
5. `assertSupabaseConfigured()` - 36 edges
6. `UserDashboard()` - 36 edges
7. `PredictionRow` - 30 edges
8. `run()` - 28 edges
9. `isAuthorizedCronOrInternalRequest()` - 27 edges
10. `clamp()` - 26 edges

## Surprising Connections (you probably didn't know these)
- `handleSnapshot()` --indirect_call--> `extractBetEvent()`  [INFERRED]
  api/backtest.js → server-utils/backtest/BacktestAnalytics.js
- `refreshMarketRolling()` --indirect_call--> `fx()`  [INFERRED]
  api/cron/warm-predict.js → tests/ultraUniqueQuota.test.js
- `handleLive()` --indirect_call--> `fx()`  [INFERRED]
  api/fixtures.js → tests/ultraUniqueQuota.test.js
- `runFixtureStageLoop()` --indirect_call--> `fx()`  [INFERRED]
  server-utils/pipeline/stages/runFixtureStageLoop.js → tests/ultraUniqueQuota.test.js
- `resolvePublicBaseUrl()` --calls--> `resolveTrustedAppOrigin()`  [EXTRACTED]
  api/admin.js → server-utils/publicBaseUrl.js

## Import Cycles
- None detected.

## Communities (199 total, 11 thin omitted)

### Community 0 - "healthBundle.js"
Cohesion: 0.22
Nodes (20): handleHealth(), getDailyCacheStats(), buildHealthBundle(), buildOpsAlerts(), checkKv(), checkSupabase(), generateDailyReport(), levelFrom() (+12 more)

### Community 1 - "AdminObservatory.tsx"
Cohesion: 0.05
Nodes (48): App(), AdminFilterDeck(), AdminFilterDeckProps, AdminIconRail(), AdminInsightColumnProps, AdminModelMetricsPanel(), AdminModelMetricsPanelProps, AdminObservatoryHeader() (+40 more)

### Community 2 - "Stage03LambdaGeneration.js"
Cohesion: 0.18
Nodes (22): extractAdvancedGoalsAverages(), normalizeTeamStatisticsPayload(), buildStatsFromFinishedFixtures(), buildTeamContext(), fetchTeamStatisticsFromRecentFixtures(), fetchTeamStatisticsWithSeasonFallback(), isUefaClubCompetition(), leaguePriorLambdas() (+14 more)

### Community 3 - "ml/index.js"
Cohesion: 0.08
Nodes (38): buildTrainingDataset(), buildTrainingExample(), DATASET_SCHEMA, summarizeDataset(), toMatrix(), assignTimeSplits(), clipFeatures(), DEFAULT_CLIP_BOUNDS (+30 more)

### Community 4 - "ContextEngine.js"
Cohesion: 0.13
Nodes (44): applyContextToLambdas(), evaluateContext(), neutralContextResult(), REGISTRY, runModule(), UNIMPLEMENTED_MODULE_IDS, clamp(), CONTEXT_MODULE_IDS (+36 more)

### Community 5 - "FeatureImportanceEngine.js"
Cohesion: 0.20
Nodes (15): activationFromFactor(), activationFromScore100(), computeActivations(), FeatureImportanceItem, FeatureImportanceResult, FeatureImportanceEngine, featureImportanceToMlVector(), moduleDetail() (+7 more)

### Community 6 - "runFixtureStageLoop.js"
Cohesion: 0.09
Nodes (38): handler(), getLeagueConfidenceMultiplier(), getLeagueParams(), getLeagueProfile(), getLeagueStakeCap(), getModelMarketBlendWeight(), buildGoldenContext(), defaultFx() (+30 more)

### Community 7 - "Module reference"
Cohesion: 0.05
Nodes (39): Categories, Confidence Engine (Independent), Contract, Dimensions (each 0–100), Independence guarantee, UI, Weights, Wiring (+31 more)

### Community 8 - "EnterpriseDashboard.tsx"
Cohesion: 0.06
Nodes (44): ApiUsageBarChart(), ConfidenceAreaChart(), heatColor(), LeagueBarChart(), LeagueMarketHeatmap(), MarketPieChart(), PerformanceRadarChart(), PIE_COLORS (+36 more)

### Community 9 - "LandingAccess.tsx"
Cohesion: 0.10
Nodes (23): BrandArtboardProps, Header(), HeaderProps, ModelPulseWave(), BRAND_IMAGES, LANDING_PREVIEW_LOGOS, ManagedProfile, mapSupabaseUser() (+15 more)

### Community 10 - "ValueEngine.js"
Cohesion: 0.10
Nodes (39): EvSignal, buildExplanation(), calculateExpectedValue(), calculateKellyPct(), calculateValueScore(), clamp(), classifyEvSignal(), evaluateValue() (+31 more)

### Community 11 - "src/types.ts"
Cohesion: 0.06
Nodes (36): fmtMs(), HealthDashboard(), statusTone(), tip, widgetTone(), pct(), PerformanceApiResponse, PerformanceCounterModal() (+28 more)

### Community 12 - "BacktestAnalytics.js"
Cohesion: 0.13
Nodes (28): buildBacktestReport(), buildDashboardBundle(), buildReturnsHistogram(), clamp(), computeBacktestMetrics(), computeQuantMetrics(), confidenceDistribution(), extractBetEvent() (+20 more)

### Community 13 - "useAppController.ts"
Cohesion: 0.12
Nodes (34): addCalendarDayIso(), DatePicker(), DatePickerProps, ELITE_LEAGUES, AuthApi, useAppAuthActions(), useAppController(), useBacktest() (+26 more)

### Community 14 - "daily-ml.js"
Cohesion: 0.10
Nodes (26): brierForSamples(), buildStackerDataset(), CALIBRATION_MIN_SAMPLES, CALIBRATION_WINDOW_DAYS, fitBestCalibration(), LEAGUE_PROFILE_MIN_SAMPLES, LEAGUE_PROFILE_SHRINKAGE_K, LEAGUE_PROFILE_WINDOW_DAYS (+18 more)

### Community 15 - "confidence/ConfidenceEngine.js"
Cohesion: 0.12
Nodes (38): clamp(), ConfidenceEngine, dim(), DIMENSION_LABELS, DIMENSION_SCORERS, hashUnit(), leagueAvgFrom(), ratioToScore() (+30 more)

### Community 16 - "UserDashboard.tsx"
Cohesion: 0.09
Nodes (37): Props, Toast(), useHistorySync(), UseHistorySyncOptions, isTerminalOrAbandonedStatus(), Options, SetPreds, shouldPollFixtureScore() (+29 more)

### Community 17 - "Stage07ModelFusion.js"
Cohesion: 0.14
Nodes (28): removeBookmakerMargin(), shinImpliedProbs(), consensusBttsOdds(), consensusDoubleChanceOdds(), consensusMatchWinnerOdds(), consensusOverUnderOddsAtLine(), FIRST_HALF_GOALS_MARKET_NAMES, impliedProbsFromConsensus() (+20 more)

### Community 18 - "Stage02FeatureCollection.js"
Cohesion: 0.13
Nodes (35): calculateEnsembleStake(), calculateEV(), calculateKellyQuarter(), evaluateNoBetZone(), factorial(), getPoissonProbability(), attachRecommendationExplanation(), buildConfidenceEngine() (+27 more)

### Community 19 - "rebuildTeamMarketRolling.js"
Cohesion: 0.16
Nodes (19): refreshMarketRolling(), API_DELAY_MS, API_MAX_RETRIES, API_RETRY_BACKOFF_MS, apiFetch(), apiGetThrottled(), backfillLeagueSeason(), CONSECUTIVE_429_STOP (+11 more)

### Community 20 - "LocaleContext.tsx"
Cohesion: 0.13
Nodes (26): ADMIN_PREDICT_FLOW_MESSAGES, msgs(), PredictFlowMessages, USER_PREDICT_FLOW_MESSAGES, LocaleContext, LocaleContextValue, LocaleProvider(), applyTheme() (+18 more)

### Community 21 - "Stage01DataCollection.js"
Cohesion: 0.10
Nodes (40): handleDay(), handler(), ACTION_LIMIT_BY_TIER, CONFIDENCE_CATEGORY_THRESHOLDS, confidenceCategory(), decrementPredictCountToday(), FREE_DAYS_LIMIT, getPredictCountToday() (+32 more)

### Community 22 - "MatchModal.tsx"
Cohesion: 0.08
Nodes (32): LuckBadge(), LuckBadgeProps, deriveBestOverUnderPick(), deriveRecommendedOdd(), DETAIL_TABS, DetailTabId, evaluateTopPick(), fallbackTierFromProb() (+24 more)

### Community 23 - "LeagueProfile.js"
Cohesion: 0.12
Nodes (30): cached, clamp(), clampPct(), DEFAULT_CONFIG_PATH, __dirname, getLeagueProfile(), getLeagueProfileSnapshot(), listConfiguredLeagueIds() (+22 more)

### Community 24 - "PerformancePanel.tsx"
Cohesion: 0.07
Nodes (29): AdminPerformanceObservatory(), AdminPerformanceTables(), AdminPerformanceTablesProps, AdminUsageSnapshot(), AdminUsageSnapshotProps, AdminUsersPanel(), AdminUsersPanelProps, ManagedProfile (+21 more)

### Community 25 - "history.js"
Cohesion: 0.14
Nodes (34): buildPerformancePayload(), fetchFixtureMarketTotals(), handleClosingOdds(), handleHistoryRead(), handleHistorySync(), handlePerformanceRead(), handler(), isAuthorizedHistorySync() (+26 more)

### Community 26 - "CalibrationSelector.js"
Cohesion: 0.15
Nodes (29): binLabel(), brier(), CalibrationSelector, evaluateCalibrationMethods(), expectedCalibrationErrorBinary(), fitMethod(), identityCurve(), kFolds() (+21 more)

### Community 27 - "useBacktest.ts"
Cohesion: 0.14
Nodes (11): StatisticsPanelProps, StatTile(), Tone, toneClass, UseBacktestOptions, loadAlerts(), LoadAlertsResult, loadKpi() (+3 more)

### Community 28 - "admin.js"
Cohesion: 0.24
Nodes (15): handleMl(), handleProfiles(), handler(), inferSeason(), normalizeSubscriptionExpiry(), normalizeTierInput(), parseBody(), resolvePublicBaseUrl() (+7 more)

### Community 29 - "devDependencies"
Cohesion: 0.07
Nodes (29): autoprefixer, @eslint/js, eslint-plugin-react-hooks, globals, jsdom, devDependencies, autoprefixer, @eslint/js (+21 more)

### Community 30 - "useLocale"
Cohesion: 0.07
Nodes (31): ExplanationCard(), isFormReason(), polarityClass(), barColor(), FeatureImportanceChart(), MonteCarloPanel(), Props, tip (+23 more)

### Community 31 - "fitStacker.js"
Cohesion: 0.14
Nodes (28): runStacker(), buildDataset(), MIN_SAMPLES_GLOBAL, MIN_SAMPLES_LEAGUE, oneHot(), run(), SGD_OPTS, upsertWeights() (+20 more)

### Community 32 - "getSupabaseAdmin"
Cohesion: 0.25
Nodes (12): decrementPredictCountBy(), getRequester(), handleClaimBootstrapAdmin(), parseAdminEmailsFromEnv(), persistContextSnapshots(), computeRefereeStatsFromHistory(), envInt(), FINAL_STATUSES (+4 more)

### Community 33 - "fixtures.js"
Cohesion: 0.17
Nodes (19): enforceAnonRateLimit(), handleLive(), handler(), handleXg(), LIVE_SCORES_CACHE_TTL_SEC, parseHalftimeGoals(), parseIds(), parseRefereeName() (+11 more)

### Community 34 - "Stage05Simulation.js"
Cohesion: 0.18
Nodes (22): advancedLambdas(), bivariatePoissonP(), buildMatchScorePmf(), clamp(), clampFactor(), clampLambda(), computeMatchProbs(), deriveFirstHalfLambdas() (+14 more)

### Community 35 - "PredictionEngine/types.ts"
Cohesion: 0.14
Nodes (14): EngineModule, H2HFixture, InjuryEntry, LeagueParams, LineupInfo, ModuleScore, OddsTriple, PredictionEngineResult (+6 more)

### Community 36 - "specialBet.ts"
Cohesion: 0.18
Nodes (19): HistorySpecialBetCard(), Props, matchingMarketOdd(), parseOuSide(), resolveFirstHalfGoalsActual(), shotsDisplayOdd(), bttsOddForPick(), buildSpecialBetLegs() (+11 more)

### Community 37 - "PredictionFocusCard.tsx"
Cohesion: 0.13
Nodes (31): fmtOdd(), MarketRow, PredictionFocusCard(), Props, sidePickLabel(), weatherCodeKey(), CardMarketValidations, CardMarketId (+23 more)

### Community 38 - "predictionLaboratory.ts"
Cohesion: 0.29
Nodes (24): attackScore(), bookmakerDifference(), buildComparison(), buildEvolution(), buildPredictionLaboratory(), clamp(), confidenceScore(), defenseScore() (+16 more)

### Community 39 - "billing.js"
Cohesion: 0.21
Nodes (22): appOrigin(), attachJsonBody(), config, handleCheckout(), handleConfig(), handlePortal(), handler(), handleTrial() (+14 more)

### Community 40 - "math.test.js"
Cohesion: 0.12
Nodes (23): blendModelWithMarket(), buildCacheKey(), applyStacker(), cached, clamp01(), extractStackerFeatures(), pickStackerWeightsForLeague(), safeLog() (+15 more)

### Community 41 - "compilerOptions"
Cohesion: 0.09
Nodes (22): DOM, DOM.Iterable, ES2020, compilerOptions, allowJs, esModuleInterop, forceConsistentCasingInFileNames, ignoreDeprecations (+14 more)

### Community 42 - "result"
Cohesion: 0.22
Nodes (8): result(), calculate(), LineupEngine, LineupEngine, intensityFactor(), calculate(), RecentMatches, RecentMatches

### Community 43 - "cardMarketSettlement.js"
Cohesion: 0.19
Nodes (18): deriveAlignedOuPick(), deriveBestGoalsPick(), deriveBestOverUnderPick(), deriveCardMarketPicks(), evaluateOuLine(), evaluateTopPick(), FINAL_STATUSES, isFinalStatus() (+10 more)

### Community 44 - "Stage04ProbabilityGeneration.js"
Cohesion: 0.23
Nodes (18): finalizeLambdasWithRollingXg(), buildLiveRollingForTeam(), hasUsableRolling(), roundDisplayRate(), blendLambdasWithXg(), PIPELINE_STAGES, PredictorV2, run() (+10 more)

### Community 45 - "PredictionLaboratory.js"
Cohesion: 0.36
Nodes (21): attackScore(), bookmakerDifference(), buildComparison(), buildEvolution(), buildPredictionLaboratory(), clamp(), confidenceScore(), defenseScore() (+13 more)

### Community 46 - "Dimension Notes (audit detail)"
Cohesion: 0.06
Nodes (35): Architecture — 6.5, Architecture & backend (21–40), Backend — 6.0, Cache — 7.5, Cache & performance (56–70), Commercial & growth (86–95), Commercial Readiness — 3.5, Competitor Comparison (+27 more)

### Community 47 - "design-system/index.ts"
Cohesion: 0.10
Nodes (22): APP_NAV_ITEMS, AppNavView, MatchesSubFilter, MOBILE_TAB_ITEMS, Props, Props, Props, NavIcon() (+14 more)

### Community 48 - "TipEvent.js"
Cohesion: 0.25
Nodes (13): buildClvReport(), computeClvPct(), mean(), median(), monthKey(), num(), clamp01(), extractTipEvents() (+5 more)

### Community 49 - "overlayStore.js"
Cohesion: 0.27
Nodes (13): cache, cacheKey(), filePath(), getLatestCalibrationReport(), listCalibrationRuns(), loadActiveOverlays(), loadFileStore(), mapOverlayRow() (+5 more)

### Community 50 - "dependencies"
Cohesion: 0.11
Nodes (19): dependencies, react, react-dom, react-router-dom, recharts, redis, stripe, @supabase/supabase-js (+11 more)

### Community 51 - "helpers.js"
Cohesion: 0.22
Nodes (10): applyBayesianShrinkage(), AttackStrength, calculate(), AttackStrength, calculate(), clampFactor(), leagueAvgFromContext(), calculate() (+2 more)

### Community 52 - "scripts"
Cohesion: 0.11
Nodes (18): scripts, api, backtest, build, dev, lint, preview, test (+10 more)

### Community 53 - "ModelLab.js"
Cohesion: 0.25
Nodes (16): applyInjuries(), argmax(), blendModel(), blendSources(), evaluateModel(), getModelById(), homeAdvElo(), MODEL_REGISTRY (+8 more)

### Community 54 - "usePerformanceTracker.ts"
Cohesion: 0.30
Nodes (9): isCompactViewport(), usePerformanceTracker(), LoadHistoryResult, HistoryEntry, HistoryStats, historyStatsFromRows(), listCardMarketOutcomes(), MARKET_KEYS (+1 more)

### Community 55 - "PoissonEngine.js"
Cohesion: 0.47
Nodes (3): calculate(), PoissonEngine, PoissonEngine

### Community 56 - "Enterprise Audit Report — Footy Predictor Pro"
Cohesion: 0.06
Nodes (31): 10. Commercial Readiness — 3.5, 1. Architecture — 6.5, 2. Prediction Engine — 8.0, 3. Confidence Engine — 7.5, 4. API — 6.0, 5. Cache — 7.5, 6. Performance — 6.5, 7. Security — 4.0 (release blocker) (+23 more)

### Community 57 - "HomeSection.tsx"
Cohesion: 0.18
Nodes (12): HistorySection(), Props, rowKey(), toneFor(), confOf(), evOf(), HomeSection(), isFinal() (+4 more)

### Community 58 - "clamp"
Cohesion: 0.21
Nodes (9): AwayStrength, calculate(), AwayStrength, clamp(), injurySeverity(), calculate(), InjuriesEngine, InjuriesEngine (+1 more)

### Community 59 - "User Experience V3"
Cohesion: 0.07
Nodes (27): 10. Responsive behavior, 11. Accessibility UX, 12. Wireframes, 13. Acceptance (user), 14. Mapping from current UserDashboard, 1. Experience principles, 2. Personas & jobs, 3.1 First session (post-login) (+19 more)

### Community 60 - "ConfidenceEnginePanel.tsx"
Cohesion: 0.29
Nodes (10): barWidth(), categoryTone(), ConfidenceEngineData, ConfidenceEnginePanel(), DIMENSION_KEYS, overallToneClass(), scoreToneClass(), DIM_KEYS (+2 more)

### Community 61 - "isAuthorizedCronOrInternalRequest"
Cohesion: 0.20
Nodes (14): asNum(), handler(), reasonCodesFromRow(), buildEmailHtml(), getUserEmail(), handler(), sendEmail(), readBearer() (+6 more)

### Community 62 - "PredictionExplanation.js"
Cohesion: 0.30
Nodes (11): buildPredictionExplanation(), countBtts(), PredictionExplanationResult, num(), pickImpliesMarket(), PredictionExplanation, reasonOddsSupport(), sliceForm() (+3 more)

### Community 63 - "isotonicCalibration.js"
Cohesion: 0.26
Nodes (11): applyCalibratedBinary(), applyCalibratedTriple(), applyIsotonicMap(), applySideMarketCalibration(), cachedMaps, pickCalibrationMapForLeague(), applyLeagueMarketPriors(), reweightPmfTo1x2() (+3 more)

### Community 64 - "4. Section specs"
Cohesion: 0.08
Nodes (24): 10. ASCII — Models page, 1. Goals, 2. Information architecture, 3. Before → After, 4.10 Cache / API Usage, 4.11 Logs / Security / Settings, 4.1 Dashboard (KPIs), 4.2 Prediction Engine (+16 more)

### Community 65 - "exclude"
Cohesion: 0.15
Nodes (12): backups, dist, node_modules, scripts, server-utils, tests, ./tsconfig.json, exclude (+4 more)

### Community 66 - "api/backtest.js"
Cohesion: 0.16
Nodes (28): handleAnalytics(), handleClv(), handleKpi(), handleModelLab(), handleModelSelect(), handlePublicTrack(), handler(), handleSnapshot() (+20 more)

### Community 67 - "MatchCard.tsx"
Cohesion: 0.21
Nodes (14): AdminInsightColumn(), deriveBestOverUnderPick(), deriveRecommendedOdd(), evaluateTopPick(), isFinalStatus(), MatchCard(), MatchCardProps, modelTierBadge() (+6 more)

### Community 68 - "useKickoffWeather.ts"
Cohesion: 0.23
Nodes (12): CacheEntry, cacheKey(), fetchHourlyTemp(), geoCache, geocodeQuery(), KickoffWeather, memoryCache, pickClosestHour() (+4 more)

### Community 69 - "Feature Roadmap UI — Placeholders & Integration (No Backend Changes)"
Cohesion: 0.08
Nodes (24): 10. Recommended first implementation PR (when coding starts), 1. Feature inventory, 2. Derived UI metrics (client-only, honest), 3. Phased delivery, 4. Component / state sketch, 5. Wireframes — new features, 6. Zero-regression gates per phase, 7. Out of scope (explicit) (+16 more)

### Community 70 - "API Optimization Report"
Cohesion: 0.09
Nodes (22): 1. Canonical cache keys + in-flight dedupe (`fetcher.js`), 2. Batch odds by date (`oddsPrefetch.js` + `predict.js`), 3. Improved warm process (`warm.js` + cron + client), 4. History sync smarter path (`history.js`), 5. Client throttle, 6. Cron reserve sanity (`warm-predict.js`), API Optimization Report, Cache Efficiency (+14 more)

### Community 71 - "TrackRecordSection.tsx"
Cohesion: 0.24
Nodes (9): fmtPct(), fmtUnits(), Props, RANGE_OPTIONS, TrackRecordSection(), loadPublicTrackRecord(), PublicTrackRecord, TrackRecordSummary (+1 more)

### Community 72 - "backtestContextEngine.mjs"
Cohesion: 0.14
Nodes (24): handleMetrics(), buildCalibrationGroups(), fetchContextSnapshots(), mergeSnapshotIntoEngineCtx(), newAggregate(), oddsForPick(), pickFromProbs(), reconstructEngineCtx() (+16 more)

### Community 73 - "ValueCard.tsx"
Cohesion: 0.24
Nodes (8): formatEv(), MarketRow, marketSignal(), resolveSignal(), SIGNAL_STYLES, ValueCard(), ValueCardProps, ValueEngineData

### Community 74 - "MonteCarloEngine.js"
Cohesion: 0.47
Nodes (9): computeExactMarketProbabilities(), computeExactMatchDistribution(), goalSideStats(), marginalHistogram(), marginalize(), marginalMean(), marginalPercentile(), round2() (+1 more)

### Community 75 - "goldenFixture.test.js"
Cohesion: 0.31
Nodes (5): __dirname, GOLDEN_DIR, buildDefaultOddsPayload(), DEFAULT_ELO, setGoldenMocks()

### Community 76 - "vercel.json"
Cohesion: 0.22
Nodes (8): maxDuration, maxDuration, crons, functions, api/cron/daily-ml.js, api/cron/warm-predict.js, headers, rewrites

### Community 77 - "overrides"
Cohesion: 0.25
Nodes (8): overrides, js-yaml, minimatch, path-to-regexp, smol-toml, undici, @vercel/node, ajv

### Community 78 - "rebuildElo.js"
Cohesion: 0.33
Nodes (7): extractResult(), fetchFixturesForLeagueSeason(), rebuildForLeague(), run(), UPSTREAM, persistEloMap(), fx()

### Community 79 - "package.json"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

### Community 80 - "ModelInterface.ts"
Cohesion: 0.29
Nodes (6): ModelFamily, ModelPredictInput, ModelPredictOutput, ModelStatus, ModelTask, TrainingDatasetLike

### Community 81 - "AdminUsersTable.tsx"
Cohesion: 0.43
Nodes (6): AdminUsersTable(), AdminUsersTableProps, isExpiredSubscription(), isoToLocalDatetimeInput(), ManagedProfile, tierToneClass()

### Community 82 - "record-golden-fixture.mjs"
Cohesion: 0.33
Nodes (5): args, __dirname, env, r, root

### Community 83 - "ConfidenceEngine.ts"
Cohesion: 0.47
Nodes (3): calculate(), ConfidenceEngine, ConfidenceEngine

### Community 84 - "PredictionContext"
Cohesion: 0.22
Nodes (6): DefenseStrength, DefenseStrength, calculate(), FormEngine, FormEngine, PredictionContext

### Community 85 - "H2HEngine.js"
Cohesion: 0.47
Nodes (3): calculate(), H2HEngine, H2HEngine

### Community 86 - "HomeAdvantage.ts"
Cohesion: 0.47
Nodes (3): calculate(), HomeAdvantage, HomeAdvantage

### Community 87 - "neutral"
Cohesion: 0.22
Nodes (8): neutral(), calculate(), MotivationEngine, MotivationEngine, calculate(), RestDaysEngine, restFactor(), RestDaysEngine

### Community 88 - "OddsEngine.js"
Cohesion: 0.47
Nodes (3): calculate(), OddsEngine, OddsEngine

### Community 89 - "RecommendationEngine.ts"
Cohesion: 0.47
Nodes (3): calculate(), RecommendationEngine, RecommendationEngine

### Community 90 - "RefereeEngine.js"
Cohesion: 0.47
Nodes (3): calculate(), RefereeEngine, RefereeEngine

### Community 91 - "4.3 Stage specifications"
Cohesion: 0.09
Nodes (22): 4.3 Stage specifications, S00 — IngressPolicy, S01 — DataCollection, S02 — CacheResolve, S03 — FeatureExtraction, S04 — EnrichmentBus, S05 — XgResolve, S06 — LambdaGeneration (+14 more)

### Community 92 - "WeatherEngine.js"
Cohesion: 0.47
Nodes (3): calculate(), WeatherEngine, WeatherEngine

### Community 93 - "GuestHeaderControls.tsx"
Cohesion: 0.40
Nodes (3): CallsCounter(), CallsCounterProps, GuestHeaderControlsProps

### Community 94 - "PRODUCTION CERTIFICATION REPORT"
Cohesion: 0.09
Nodes (21): 10. Remaining technical debt (non-blocking for closed beta), 11. Risk assessment, 12. Expected Enterprise Audit score, 13. Confidence level, 14. Success criteria checklist, 1. Files modified / created, 2. Security issues resolved, 3. Endpoints protected (+13 more)

### Community 95 - "TodayOverview.tsx"
Cohesion: 0.60
Nodes (5): confOf(), evOf(), Props, Rail(), TodayOverview()

### Community 96 - "scripts/backtest.js"
Cohesion: 0.83
Nodes (3): getSelectedOdd(), pct(), run()

### Community 100 - "Component Library V3"
Cohesion: 0.10
Nodes (20): 10. Skeleton loading, 11. File mapping (implementation), 12. Regression checklist per component, 1. Hierarchy, 2. Atoms, 3. Molecules, 4.1 `MatchCardV3`, 4.2 `MatchDetailShell` (+12 more)

### Community 101 - "Predictor V2 — Integration Report"
Cohesion: 0.10
Nodes (19): 10. Verdict, 1. Final pipeline, 2.1 Layers, 2.2 Engine modules (all live when `modularBlend=1`), 2.3 Pipeline audit payload, 2. Architecture, 3. Performance, 4. Accuracy improvements (+11 more)

### Community 104 - "UI / UX Masterplan — Footy Predictor Pro V3"
Cohesion: 0.10
Nodes (19): 10. Live experience (UI-ready), 11. Backtest → Analytics, 12. Implementation phases (zero regression), 13. Migration strategy, 14. Success metrics (UX), 15. Wireframe — navigation flow, 1. Mission, 2. Non-negotiables (preserve) (+11 more)

### Community 105 - "SignalLab.tsx"
Cohesion: 0.11
Nodes (16): PredictionContributionsChart(), ConfidenceAura(), ConfidenceAuraProps, EdgeCompass(), EdgeCompassProps, FormRibbon(), FormRibbonProps, ModelPulseStrip() (+8 more)

### Community 106 - "fetcher.js"
Cohesion: 0.16
Nodes (16): buildFetchUrl(), buildLegacyCacheKey(), bumpDailyCacheStats(), getApiUsageHistory(), getDateISOWithOffset(), getLocalCacheStats(), getTodayISO(), getUpstreamProvider() (+8 more)

### Community 110 - "warm-predict.js"
Cohesion: 0.21
Nodes (15): handler(), inferSeason(), parseLeagueIds(), handler(), inferSeason(), MARKET_REFRESH_BUDGET_CALLS, MARKET_REFRESH_WINDOW_DAYS, parseLeagueIds() (+7 more)

### Community 113 - "ML Ready — Footy Predictor"
Cohesion: 0.12
Nodes (16): Available Features, CatBoost, Extended (extractable from history / `raw_payload`, not yet in stacker), Future Models, Layout, LightGBM, Missing Features, ML Ready — Footy Predictor (+8 more)

### Community 117 - "AutoCalibrationEngine.js"
Cohesion: 0.29
Nodes (15): buildCalibrationReport(), clamp(), computeBrier1x2(), computeEce(), computeReliabilityBuckets(), extractSamplesFromHistory(), fitAutoCalibrationOverlays(), fitFeatureWeightDeltas() (+7 more)

### Community 118 - "useWarm.ts"
Cohesion: 0.23
Nodes (11): isDesktopViewport(), useLeaguePanelState(), parseBackendError(), SessionLike, usePredictFlow(), UsePredictFlowOptions, useWarm(), UseWarmOptions (+3 more)

### Community 119 - "Frontend App Architecture Refactor"
Cohesion: 0.12
Nodes (15): Architecture, Docs, Files created, Files modified, Frontend App Architecture Refactor, Future recommendations, Goal, Hooks (+7 more)

### Community 120 - "Probability Calibration Report"
Cohesion: 0.13
Nodes (14): 1. Verdict, 2. Methods, 3. Evaluation protocol, 4.1 Overconfident, 4.2 Underconfident, 4.3 Sigmoid bias, 4.4 Already well calibrated, 4. Synthetic bake-off results (n=400 each) (+6 more)

### Community 121 - "Prediction Engine Execution Report"
Cohesion: 0.13
Nodes (14): 1. Execution Flow Diagram, 2. Active Modules (materially affect the live prediction), 3. Inactive Modules (execute but do NOT affect λ), 4. Dead Code (never imported at runtime), 5. Missing Inputs (`engineCtx` gaps), 6. Weight Table, 7. Why Each Module Is Ignored, 8. Estimated Impact If Activated (+6 more)

### Community 122 - "Predictor V3 Foundation Report"
Cohesion: 0.13
Nodes (14): 10. Risk analysis (foundation), 11. How to verify locally, 12. Summary, 1. Mission outcome, 2. New folder structure, 3. LOC before / after, 4. Stage graph, 5. Dependency graph (+6 more)

### Community 123 - "USER_UI_AUDIT.md"
Cohesion: 0.13
Nodes (13): 10. Audit completeness statement, 1. Routes, 2. Pages & sections, 3. Component inventory (user), 4. Modals / dialogs / drawers, 5. Match detail tabs (current), 6. Hooks (UserDashboard), 7. Primary user flows (+5 more)

### Community 124 - "metricsStore.js"
Cohesion: 0.30
Nodes (14): bumpFailure(), emptyChannel(), emptyDayMetrics(), getOpsMetrics(), getOpsMetricsHistory(), kv, percentile(), pushSample() (+6 more)

### Community 125 - "ENTERPRISE UI V2 REPORT"
Cohesion: 0.14
Nodes (13): 10. Confirmation checklist, 1. Components redesigned, 2. Components moved / restructured, 3. Buttons / handlers repaired, 4. Broken handlers fixed, 5. Hidden admin components (user dashboard), 6. Remaining UX issues, 7. Performance improvements (+5 more)

### Community 126 - "UI_COMPONENT_INVENTORY.md"
Cohesion: 0.14
Nodes (12): 10. Services touched by UI (read-only for V4), 11. Coverage vs V4 brief, 1. Routing & shells, 2. Public pages, 3. UX sections (workspace), 4. Match surfaces, 5. Intelligence panels (modal / labs), 6. Performance & billing UI (+4 more)

### Community 127 - "USER_NAVIGATION_MAP.md"
Cohesion: 0.14
Nodes (12): 1. Current navigation (shipped), 2. Target navigation (V4 brief), 3. Click-budget goals (V4), 4. Navigation path catalog (current), 5. Dead / confusing paths, 6. Approval note, Current vs Target Navigation (UX V4), Desktop (+4 more)

### Community 128 - "UpgradePrompt.tsx"
Cohesion: 0.21
Nodes (9): formatLocalEur(), listPriceFromCampaignSafe(), PlanCampaignPrice(), PlanPriceProps, PricingCampaignBanner(), Props, PRICING_CAMPAIGN, Props (+1 more)

### Community 129 - "BUTTON_VALIDATION_REPORT.md"
Cohesion: 0.15
Nodes (11): AppShell (`src/components/ux/AppShell.tsx`), design-system Button, Interactive Element Audit — User UI (Static + Wiring), Landing (`src/pages/LandingAccess.tsx`), Login (`src/pages/Login.tsx`), Mandatory runtime QA script (pre-ship), MatchCard (`src/components/MatchCard.tsx`), MatchModal (`src/components/MatchModal.tsx`) (+3 more)

### Community 130 - "[Implemented] 2026-07-19 — UX V4 foundation + IA + Home"
Cohesion: 0.15
Nodes (11): [Audit] 2026-07-19 — Documentation only, Design system, Docs (audit package, still valid), Explicitly not changed, Home, [Implemented] 2026-07-19 — UX V4 foundation + IA + Home, Match surfaces, Matches / Predictions / Live (+3 more)

### Community 131 - "1. Prediction Contributions Engine (signed)"
Cohesion: 0.15
Nodes (12): 1. Prediction Contributions Engine (signed), 2. Feature Importance Engine (existing, normalized), API, Difference at a glance, Example output (shape), Feature Importance & Prediction Contributions, Files changed, How it is computed (grounded — no invented numbers) (+4 more)

### Community 132 - "Expected Goals (xG) Engine Report"
Cohesion: 0.15
Nodes (12): 1. Current implementation (before), 2. New rolling xG model (after), 3. Wiring, 4. Behavior change, 5. Verification, Data source strategy (migration-free, non-breaking), Expected Goals (xG) Engine Report, Files changed (+4 more)

### Community 133 - "closingOddsCapture.js"
Cohesion: 0.27
Nodes (8): classifyApiBudget(), evaluateApiBudget(), alreadyCaptured(), asOdd(), buildClosingOddsBlob(), CANCELLED, captureClosingOdds(), lineKey()

### Community 134 - "Prediction Engine Activation Report"
Cohesion: 0.17
Nodes (11): 1. Old Pipeline → New Pipeline, 2. Modules Executed (before vs after), 3. Weight Table (all env-configurable), 4. Runtime Cost, 5. Prediction Differences, Files Changed, New (activated mode), Old (parity mode) (+3 more)

### Community 135 - "DESIGN_SYSTEM.md"
Cohesion: 0.17
Nodes (10): 1. Principles, 2. Color (V4 target), 3. Typography scale, 4. Spacing (8pt), 5. Radius & elevation, 6. Components (canonical), 7. Terminology (user-facing), 8. Iconography (+2 more)

### Community 136 - "FINAL_ENTERPRISE_AUDIT_2026.md"
Cohesion: 0.17
Nodes (11): 21. Test Coverage Review, 22. Competitive Benchmark, 23. Technical Debt, 24. Production Risks, 27. CTO FINAL VERDICT (PREVIEW), 7. Feature Importance Validation, Coverage holes, FINAL ENTERPRISE AUDIT 2026 (+3 more)

### Community 137 - "Auto Model Selection"
Cohesion: 0.17
Nodes (11): API, Auto Model Selection, Automation (cron), Competing models, Configuration, Files, How it works, Promotion & live application (+3 more)

### Community 138 - "PRODUCTION_P0_PLAN.md"
Cohesion: 0.17
Nodes (11): 0. Executive plan summary, 10. TASK 9 — Final certification artifact, 12. Implementation order (when approved), 13. Success criteria checklist (definition of done), 14. Risk & effort, 15. Approval gate, 1. Endpoint classification matrix (as-is → to-be), 7. TASK 6 — Security hardening (+3 more)

### Community 139 - "confidenceWeights.js"
Cohesion: 0.29
Nodes (9): applyWeightDeltas(), mergeWithAutoOverlay(), round4(), getRuntimeOverlay(), CONFIDENCE_DIMENSION_KEYS, DEFAULT_CONFIDENCE_WEIGHTS, envNum(), getConfidenceWeights() (+1 more)

### Community 140 - "getWithCache"
Cohesion: 0.48
Nodes (11): getWithCache(), buildH2H(), buildInjuries(), buildLineups(), buildOdds(), buildTeamRecent(), buildWeather(), collectModuleInputs() (+3 more)

### Community 141 - "User UI Complete Redesign Plan"
Cohesion: 0.18
Nodes (10): 1. Current problems, 2. Screens affected, 3. New IA, 4. Navigation, 5. Terminology, 6. Design tokens, 7. Migration phases, 8. Risks (+2 more)

### Community 142 - "UX_IMPROVEMENTS.md"
Cohesion: 0.18
Nodes (9): Explicit non-goals (V4 UI), P0 — First 30 seconds / trust, P1 — Navigation & findability, P2 — Match card & detail, P3 — Filters, search, persistence, P4 — Micro-interactions & polish, P5 — Performance (UI-only), Prioritized UX V4 Improvements (No Engine Changes) (+1 more)

### Community 143 - "Value Betting Engine"
Cohesion: 0.18
Nodes (10): Formulas, Independence notes, Inputs, Integration (`api/predict.js`), Location, Outputs, Signal → Value Card colors, Tuning (+2 more)

### Community 144 - "ACCESSIBILITY_REPORT.md"
Cohesion: 0.20
Nodes (8): 1. Strengths (already present), 2. Gaps, 3. Keyboard map (expected), 4. Screen reader content priorities, 5. Contrast notes, 6. Pre-ship a11y checklist, 7. Verdict, Accessibility Audit — User UI (Baseline)

### Community 145 - "Professional Quantitative Backtest Engine"
Cohesion: 0.20
Nodes (9): API, Charts, Configuration, Data flow, Files changed, Metrics, Notes on scoring, Professional Quantitative Backtest Engine (+1 more)

### Community 146 - "Model Laboratory"
Cohesion: 0.20
Nodes (9): API, Configuration, Files, Metrics (per model), Model Laboratory, Models, Sources (reconstructed from stored data — no fabrication), UI (+1 more)

### Community 147 - "Monte Carlo Adaptive Simulations Report"
Cohesion: 0.20
Nodes (9): 1. Verdict, 2. Before → after, 3. Uncertainty model, 4. Tier map (empirical), 5. Production wiring, 6. Why this improves Monte Carlo, 7. Tests, 8. Files touched (+1 more)

### Community 148 - "PERFORMANCE_REPORT.md"
Cohesion: 0.20
Nodes (8): 1. Current architecture signals, 2. Risks, 3. Memoization / virtualization plan, 4. Bundle notes, 5. Loading UX map, 6. Measurement plan (pre-ship), 7. Verdict, Frontend Performance Audit — User UI (Baseline)

### Community 149 - "REGRESSION_REPORT.md"
Cohesion: 0.20
Nodes (8): 1. Protected surfaces (do not touch), 2. Functional regression matrix, 3. Permission / tier regression, 4. UI change safety checks, 5. Known baseline defects (not regressions if unchanged), 6. Rollback plan, 7. Sign-off template, Zero-Regression Contract — UX V4

### Community 150 - "RESPONSIVE_REPORT.md"
Cohesion: 0.20
Nodes (8): 1. Breakpoint model (current), 2. Surface-by-surface, 3. Horizontal scroll risks, 4. Large monitor (≥1600px), 5. Orientation / safe areas, 6. Responsive QA checklist (pre-ship), 7. Verdict, Responsive Audit — User UI (Baseline)

### Community 151 - "PredictionEngine/index.js"
Cohesion: 0.38
Nodes (7): combineLambdas(), optionalAdjustment(), sideFactor(), toModuleScore(), build(), MODULES, DEFAULT_PREDICTION_WEIGHTS

### Community 152 - "publicBaseUrl.js"
Cohesion: 0.51
Nodes (8): assertHostAllowlisted(), buildInternalApiUrl(), corsOriginIfAllowed(), getAllowedAppHosts(), hostnameFromBaseUrl(), isProductionRuntime(), resolveTrustedAppOrigin(), stripTrailingSlash()

### Community 153 - "Required modifications"
Cohesion: 0.22
Nodes (9): 5.1 New module, 5.2 Wire into production selection, 5.3 Metrics (required outputs), 5.4 Accuracy constraint, 5.5 Tests, 5. TASK 4 — Walk-forward validation, Design (no accuracy claim — methodology only), Problem (+1 more)

### Community 154 - "Required modifications"
Cohesion: 0.22
Nodes (9): 6.1 Analytics layer, 6.2 API (no new function file if possible), 6.3 Admin UI (minimal — not a redesign), 6.4 Persistence, 6.5 Tests, 6. TASK 5 — Closing Line Value (CLV), Already present, Gaps to close (+1 more)

### Community 155 - "PredictionContributions.js"
Cohesion: 0.36
Nodes (8): buildPredictionContributions(), envNum(), LABELS, moduleFactors(), num(), OPTIONAL_KEYS, PredictionContributionsEngine, safeLn()

### Community 156 - "Context Engine — Historical Backtest"
Cohesion: 0.25
Nodes (7): Context Engine — Historical Backtest, Diagnostics, Interpretation, Methodology, Recommendation: keep `CONTEXT_ENGINE_ENABLED=1`, but treat it as unproven, Results (30-day window), Why offline, not live

### Community 157 - "1.2 Module inventory (live)"
Cohesion: 0.25
Nodes (8): 1.2 Module inventory (live), Data collection & cache, Decision & explain, Feature / strength / λ, Ingress & policy, Persist & offline, Post-λ probability stack, Probabilities & simulation

### Community 158 - "STEP 3 — Structural Findings"
Cohesion: 0.25
Nodes (8): 3.1 Duplicated logic, 3.2 Dead / low-signal code (keep for compatibility, mark clearly), 3.3 Unnecessary passes / double calculation, 3.4 Bottlenecks, 3.5 Coupling, 3.6 Wrong / misleading execution order, 3.7 Train / serve inconsistencies (P0 quant), STEP 3 — Structural Findings

### Community 159 - "manualLocks.js"
Cohesion: 0.64
Nodes (7): camelToEnvSuffix(), envSet(), getConfidenceManualLocks(), getFeatureImportanceManualLocks(), getPredictionManualLocks(), getValueManualLocks(), locksForKind()

### Community 160 - "overlayRuntime.js"
Cohesion: 0.39
Nodes (6): clearRuntimeOverlays(), overlaysEnabled(), refreshAutoCalibrationOverlays(), runtime, setRuntimeOverlays(), invalidateAutoCalibrationCache()

### Community 161 - "PREDICTOR_V3_ARCHITECTURE.md"
Cohesion: 0.29
Nodes (6): 1.1 What “Predictor V2” actually is, Appendix A — Current vs V3 stage mapping, Appendix B — Explicit non-goals for V3.0, Appendix C — Decision log (architecture), Predictor V3 — Architecture Specification, STEP 1 — Current Pipeline Inventory

### Community 162 - "5.3 Migration strategy"
Cohesion: 0.29
Nodes (7): 5.3 Migration strategy, Phase 0 — Freeze contract (docs only) ✅ this document, Phase 1 — Extract without behavior change, Phase 2 — Order normalization (flag `PREDICTOR_V3=1`), Phase 3 — Train/serve fix (flag `ML_RAW_POISSON_TRAIN=1`), Phase 4 — Performance, Phase 5 — Deprecate confusion (not code deletion)

### Community 163 - "1. Executive Summary"
Cohesion: 0.33
Nodes (6): 1. Executive Summary, Certification killers (remain), Genuinely strong, Inventory (inspected surface), Scorecard (all sections), What this system is

### Community 164 - "25. Top 100 Remaining Improvements"
Cohesion: 0.33
Nodes (6): 25. Top 100 Remaining Improvements, P0 — Security & trust (1–20), P0 — Settlement & quant honesty (21–35), P1 — Platform (36–60), P2 — Model science (61–80), P3 — Product / growth (81–100)

### Community 165 - "27. CTO Final Verdict"
Cohesion: 0.33
Nodes (6): 27. CTO Final Verdict, Appendix A — Key evidence paths, Appendix B — Inspection method, Decision, One-paragraph diligence statement, Signature block

### Community 166 - "3. AI & Prediction Engine Review"
Cohesion: 0.33
Nodes (6): 3. AI & Prediction Engine Review, Core path (live), Modules, Strengths, Verdict, Weaknesses

### Community 167 - "League Profiles"
Cohesion: 0.33
Nodes (5): Automatic apply, Catalogued competitions, Config source, League Profiles, Rates stored per profile

### Community 168 - "STEP 5 — Architecture Package"
Cohesion: 0.33
Nodes (6): 5.1 Package layout (target — not implemented yet), 5.2 Complete system diagram, 5.4 Risk analysis, 5.5 Compatibility matrix, 5.6 Success criteria (when implementation is later authorized), STEP 5 — Architecture Package

### Community 169 - "11. Complete affected file list"
Cohesion: 0.33
Nodes (6): 11. Complete affected file list, Create, Explicitly do NOT modify (unless bug blocks P0), Modify — API / server, Modify — client, Modify — tests / CI

### Community 170 - "Required modifications"
Cohesion: 0.33
Nodes (6): 2.1 `api/fixtures.js`, 2.2 Client fetch sites (must send JWT after live/xg gate), 2.3 Rate limiting, 2.4 Explicit non-changes, 2. TASK 1 — Lock down remaining public endpoints, Required modifications

### Community 171 - "Required modifications"
Cohesion: 0.33
Nodes (6): 3.1 Server (harden + prove), 3.2 Client (remove user sync paths), 3.3 Settlement UX (backward compatible), 3. TASK 2 — Secure history sync, Current truth, Required modifications

### Community 172 - "Required modifications"
Cohesion: 0.33
Nodes (6): 4.1 New shared module, 4.2 Call-site updates, 4.3 Tests, 4. TASK 3 — Host header / SSRF hardening, Attack surface today, Required modifications

### Community 173 - "ExpectedGoals.ts"
Cohesion: 0.47
Nodes (3): calculate(), ExpectedGoals, ExpectedGoals

### Community 174 - "2. Architecture Review"
Cohesion: 0.40
Nodes (5): 2. Architecture Review, Evidence, Strengths, Topology, Weaknesses

### Community 175 - "STEP 2 — Dependency Graphs"
Cohesion: 0.40
Nodes (5): 2.1 Documented / intended flow (V2 narrative), 2.2 Physical flow today (`api/predict.js`) — as executed, 2.3 λ subgraph (PredictionEngine), 2.4 Probability stack subgraph (post-λ), STEP 2 — Dependency Graphs

### Community 176 - "STEP 4 — Predictor V3 Design"
Cohesion: 0.40
Nodes (5): 4.1 Design principles, 4.2 Target execution order (V3), 4.4 Dual engines under V3 naming (preserved), 4.5 Offline / train alignment (stage-adjacent), STEP 4 — Predictor V3 Design

### Community 177 - "Footy Predictor UI"
Cohesion: 0.40
Nodes (4): Cron and internal API auth, Cron: automated Warm + Predict, Footy Predictor UI, Optional: anonymous rate limits (Warm / Predict)

### Community 178 - "13. Security Review"
Cohesion: 0.50
Nodes (4): 13. Security Review, Closed since prior audit, Open P0 / High, Security Engineer verdict

### Community 179 - "16. Frontend Review"
Cohesion: 0.50
Nodes (4): 16. Frontend Review, Architecture, Strengths, Weaknesses

### Community 180 - "17. UX Review"
Cohesion: 0.50
Nodes (4): 17. UX Review, Product Director verdict, Strengths, Weaknesses

### Community 181 - "4. Quantitative Validation"
Cohesion: 0.50
Nodes (4): 4. Quantitative Validation, Missing for certification, Present, Quant Researcher verdict

### Community 182 - "5. Statistical Validation"
Cohesion: 0.50
Nodes (4): 5. Statistical Validation, Data Scientist verdict, Gaps, Present positives

### Community 183 - "9. TASK 8 — CI"
Cohesion: 0.50
Nodes (4): 9. TASK 8 — CI, `.github/workflows/tests.yml` steps (order), Optional (same sprint if cheap), `package.json` scripts to add

### Community 184 - "10. Ensemble Validation"
Cohesion: 0.67
Nodes (3): 10. Ensemble Validation, Components, Issues

### Community 185 - "11. API Review"
Cohesion: 0.67
Nodes (3): 11. API Review, Critical API defects, Endpoint matrix (condensed)

### Community 186 - "12. Database Review"
Cohesion: 0.67
Nodes (3): 12. Database Review, Strengths, Weaknesses

### Community 187 - "14. Performance Review"
Cohesion: 0.67
Nodes (3): 14. Performance Review, Strengths, Weaknesses

### Community 188 - "15. Cache Review"
Cohesion: 0.67
Nodes (3): 15. Cache Review, Design, Risks

### Community 189 - "18. DevOps Review"
Cohesion: 0.67
Nodes (3): 18. DevOps Review, Gaps, Present

### Community 190 - "19. Monitoring Review"
Cohesion: 0.67
Nodes (3): 19. Monitoring Review, Missing, Present

### Community 191 - "20. CI/CD Review"
Cohesion: 0.67
Nodes (3): 20. CI/CD Review, Current gate, Missing for production certification

### Community 192 - "26. Roadmap v3.0"
Cohesion: 0.67
Nodes (3): 26. Roadmap v3.0, Non-goals for v3.0, Theme: **Trust before theater**

### Community 193 - "6. Explainability Review"
Cohesion: 0.67
Nodes (3): 6. Explainability Review, Limits, Present

### Community 194 - "8. Monte Carlo Validation"
Cohesion: 0.67
Nodes (3): 8. Monte Carlo Validation, Risks, Strengths

### Community 195 - "9. Calibration Validation"
Cohesion: 0.67
Nodes (3): 9. Calibration Validation, Issues, Stack

## Knowledge Gaps
- **1130 isolated node(s):** `config`, `CALIBRATION_MIN_SAMPLES`, `CALIBRATION_WINDOW_DAYS`, `STACKER_MIN_LEAGUE`, `STACKER_MIN_GLOBAL` (+1125 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useWarm()` connect `useWarm.ts` to `LandingAccess.tsx`, `ml/index.js`, `useAppController.ts`?**
  _High betweenness centrality (0.182) - this node is a cross-community bridge._
- **Why does `getSupabaseAdmin()` connect `getSupabaseAdmin` to `healthBundle.js`, `Stage03LambdaGeneration.js`, `ml/index.js`, `closingOddsCapture.js`, `daily-ml.js`, `rebuildTeamMarketRolling.js`, `Stage01DataCollection.js`, `LeagueProfile.js`, `history.js`, `admin.js`, `fixtures.js`, `Stage05Simulation.js`, `billing.js`, `math.test.js`, `overlayStore.js`, `isAuthorizedCronOrInternalRequest`, `isotonicCalibration.js`, `api/backtest.js`, `backtestContextEngine.mjs`, `rebuildElo.js`, `warm-predict.js`, `AutoCalibrationEngine.js`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **What connects `config`, `CALIBRATION_MIN_SAMPLES`, `CALIBRATION_WINDOW_DAYS` to the rest of the system?**
  _1130 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `AdminObservatory.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.05081585081585081 - nodes in this community are weakly interconnected._
- **Should `ml/index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07857142857142857 - nodes in this community are weakly interconnected._
- **Should `ContextEngine.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1286195286195286 - nodes in this community are weakly interconnected._
- **Should `runFixtureStageLoop.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08953900709219859 - nodes in this community are weakly interconnected._