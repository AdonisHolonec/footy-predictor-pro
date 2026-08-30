\# PredictorV3 Architecture



Pipeline



Stage00



↓



Stage01



↓



Stage02



↓



Stage03 (Prediction Engine)



↓



Stage04



↓



Stage05



↓



Stage06



↓



Stage07



↓



Stage08



↓



Stage09



↓



Stage10



↓



Stage11



↓



Stage12



PredictorV3 is the single source of truth.



Do not bypass any stage.



Do not duplicate prediction logic.



All new intelligence layers must be additive.



Never replace PredictorV3 outputs.



Interpret them.



\## Settlement validity is not recommendation-market validity



A persisted row in predictions\_history answers two different questions, and they must never be merged.



\### Settlement validity — validation



What happened to the market the recommendation declared. A "Shots Over 10.5" pick on a match with 25 total shots IS a win, and validation records exactly that. It is graded by resolveRecommendedValidation against the family's own statistic, its domain is fixed by migration 049 (pending, win, loss, push, half\_win, half\_loss), and nothing in the analytics layer may rewrite it. The historical row stays immutable evidence of what the system produced and showed.



\### Recommendation-market validity — recommended\_market\_valid



Whether that recommendation was a real market position, and therefore whether it counts in performance analytics. Migration 066.



TRUE means it counts.



FALSE means the recommendation was not a tradable position (see recommended\_market\_invalid\_reason); its RECOMMENDED slot is excluded from success rate and ROI.



NULL means not classified (rows predating the backfill); it still counts.



The only reason defined today is line\_off\_model\_scale: a bookmaker line below 0.60 times the model's lambda\_total for the recommendation's own market. That is the same predicate the candidate guard applies, exported once from server-utils/recommendedMarketValidity.js and reused by candidate generation, persistence, backfill and analytics.



\### Rules



Invalidity is never encoded as a loss, a push, a deletion or a fabricated settlement state.



Exclusion is per SLOT, not per fixture: a fixture whose recommendation is invalid still contributes its goals, corners and shots outcomes. Four aggregates drop the row entirely, and only because each has exactly one outcome and that outcome IS the recommended pick: the backtest tip track (resolvePublishedTip), the value-track alignment fallback (resolveBetOutcome, which was grading a value bet from the recommendation's settlement), computeSimpleRoi, and the performance\_counter\_by\_user\_league RPC.



A consumer can only apply this at all if it projects the column. Every query feeding those paths selects recommended\_market\_valid explicitly; adding a new consumer means adding it to that consumer's select list too.



1X2 metrics are unaffected by design. Brier, log-loss and accuracy read the probability triple and the final score; ECE buckets on the 1X2 pick's own probability, never on the recommendation's confidence.



Analytics eligibility controls counting only. It changes no probability, no odd, no settlement and no model.

