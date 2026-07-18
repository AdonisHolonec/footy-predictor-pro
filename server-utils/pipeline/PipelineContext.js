/**
 * PipelineContext — the ONLY mutable object passed between Predictor V3 stages.
 * No stage-owned globals; request/fixture state lives here.
 */

export function createPipelineContext(req, res) {
  return {
    req,
    res,
    /** Set true to stop the pipeline; use haltStatus/haltBody/haltHeaders to respond. */
    halted: false,
    haltStatus: null,
    haltBody: null,
    haltHeaders: {},
    // request params
    date: null,
    leagueIds: [],
    season: null,
    limit: 15,
    effectiveLimit: 15,
    // auth / tier
    usageCtx: null,
    tierContext: null,
    reservedTierUsage: 0,
    // request-scoped model assets
    engineWeights: null,
    poissonCorrelation: 0.12,
    shrinkageK: 6,
    activeModelId: "E",
    riskContext: null,
    calibrationMaps: null,
    stackerWeightsMap: null,
    // data collection
    allFixtures: [],
    oddsPrefetch: null,
    oddsByFixtureId: null,
    liveRollingCache: null,
    statsBudgetRef: null,
    // outputs
    out: [],
    persistable: [],
    masked: null,
    responseStatus: 200,
    responseBody: null,
    responseHeaders: {},
    // league loop cursor
    league: null,
    // fixture working state (reset per fixture)
    fixture: null,
    /** Predictor version stamp for meta */
    predictorVersion: "predictor-v3.1-xg-before-poisson"
  };
}

export function halt(context, status, body, headers = {}) {
  context.halted = true;
  context.haltStatus = status;
  context.haltBody = body;
  context.haltHeaders = headers || {};
  return context;
}

export function beginFixture(context, init) {
  context.fixture = { ...init, aborted: false, row: null };
  return context.fixture;
}

export function resetFixture(context) {
  context.fixture = null;
}
