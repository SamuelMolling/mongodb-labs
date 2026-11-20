/**
 * Every number that changes platform behaviour lives here.
 *
 * Routing weights, staleness windows, drift bands: a platform accumulates
 * these fast, and when they are scattered nobody can answer "why did that
 * alert fire?" without reading five modules. One screen of code is the
 * whole tuning surface.
 */
export const tuning = {
  /* -- Routing ------------------------------------------------------------ */

  // Weights are basis points. The live routes of a deployment always sum to
  // exactly this. Integers on purpose: 0.1 + 0.2 !== 0.3 is not a bug you want
  // in the code that decides which model a customer gets.
  totalWeight: 10_000,

  // A canary at 100% is a promotion with a different name and no stage
  // change, which leaves the registry lying about what is in production. The
  // ceiling forces the last step to go through promote().
  maxCanaryWeight: 9_900,

  /* -- Fleet -------------------------------------------------------------- */

  // A serving node heartbeats every 5s. One that has not reported for this
  // long is "stale": it may still be serving, but we can't vouch for what.
  staleAfterSec: 15,

  // TTL on serving_nodes.lastSeen. The TTL monitor runs about every 60s, so a
  // dead node disappears between 2 and 3 minutes after its last heartbeat.
  // The UI does not wait for that: it uses staleAfterSec.
  nodeTtlSec: 120,

  /* -- Evidence ----------------------------------------------------------- */

  // inference_log retention (time series expireAfterSeconds).
  inferenceLogTtlDays: 7,

  // Default observation window for metrics and drift, in minutes.
  defaultWindowMin: 15,

  /* -- Drift -------------------------------------------------------------- */

  // Population Stability Index bands. These are the industry rule of thumb
  // (< 0.1 stable, 0.1-0.25 worth a look, > 0.25 significant shift), not a
  // law. Calibrate them against features whose drift you already know
  // mattered before you page anyone with them.
  psi: {
    warn: 0.1,
    alert: 0.25,
  },

  // Floor applied to empty bins on either side before taking the log.
  // Without it, a bin that is empty at training time and non-empty live
  // (exactly the interesting case) makes PSI infinite.
  psiEpsilon: 1e-4,

  // Below this many live samples PSI is noise. The check reports
  // "insufficient data" instead of a number that looks precise.
  minDriftSamples: 200,

  // Share of requests with a missing or null feature that counts as a broken
  // input contract. Upstream pipelines fail by renaming a column, and the
  // first symptom is a feature that is suddenly null 100% of the time.
  contractNullRate: 0.01,

  // Absolute change in positive rate, live vs training holdout, that counts
  // as output drift.
  outputRateDelta: 0.05,
};

/**
 * Maps a PSI value onto a band.
 * @returns {"stable"|"warn"|"alert"|"insufficient"}
 */
export function psiBand(value, n) {
  if (typeof n === "number" && n < tuning.minDriftSamples) return "insufficient";
  if (typeof value !== "number" || Number.isNaN(value)) return "insufficient";
  if (value >= tuning.psi.alert) return "alert";
  if (value >= tuning.psi.warn) return "warn";
  return "stable";
}
