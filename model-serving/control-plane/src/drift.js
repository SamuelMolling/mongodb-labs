import { tuning, psiBand } from "./config.js";

/**
 * Drift and input-contract checks. The pipeline BUILDERS and the PSI
 * arithmetic are pure functions so the smoke test can pin them without a
 * cluster; observe.js runs the pipelines.
 *
 * A model never returns 500 when it is wrong. These checks are the "no" the
 * model will never say, from cheapest to most expensive:
 *
 *   1. input contract   is every feature present and numeric?
 *   2. input drift      do the live inputs look like the training inputs?
 *   3. output drift     does the live output look like the holdout output?
 *
 * (4. real accuracy needs labels; see observe.accuracy.)
 */

export const OUT_OF_RANGE = "out_of_range";

/**
 * One $facet per feature:
 *   - `${f}__contract`  missing / null / non-numeric counts
 *   - `${f}__bins`      live counts in the SAME bins as the training baseline
 *
 * Two details that matter:
 *
 * `default` on $bucket is not optional. Without it, $bucket raises an error
 * on any value outside the boundaries -- and values outside the training
 * range are exactly what this check exists to find. Leave it out and the
 * drift job crashes on the input it was written to catch.
 *
 * The $match on $type "number" before $bucket keeps nulls out of the
 * out_of_range bin. A null is a broken contract, not a shifted distribution,
 * and conflating them sends someone to retrain a model when the fix is a
 * renamed column upstream.
 */
export function buildDriftPipeline({ deploymentId, versionId, since, baseline }) {
  const facets = {};
  for (const [feature, spec] of Object.entries(baseline)) {
    const path = `$features.${feature}`;
    facets[`${feature}__contract`] = [
      {
        $group: {
          _id: null,
          n: { $sum: 1 },
          missing: { $sum: { $cond: [{ $eq: [{ $type: path }, "missing"] }, 1, 0] } },
          nulls: { $sum: { $cond: [{ $eq: [{ $type: path }, "null"] }, 1, 0] } },
          nonNumeric: {
            $sum: {
              $cond: [
                { $in: [{ $type: path }, ["missing", "null", "double", "int", "long", "decimal"]] },
                0,
                1,
              ],
            },
          },
        },
      },
    ];
    facets[`${feature}__bins`] = [
      { $match: { [`features.${feature}`]: { $type: "number" } } },
      {
        $bucket: {
          groupBy: path,
          boundaries: spec.edges,
          default: OUT_OF_RANGE,
          output: { n: { $sum: 1 } },
        },
      },
    ];
  }

  return [
    {
      $match: {
        "meta.deploymentId": deploymentId,
        "meta.versionId": String(versionId),
        ts: { $gte: since },
      },
    },
    { $facet: facets },
  ];
}

/**
 * Aligns $bucket output with the baseline's bins.
 *
 * $bucket returns one document per NON-EMPTY bin, with _id = the bin's lower
 * boundary (the exact number we passed in `boundaries`) or the default label.
 * Empty bins are simply absent, so the alignment has to be by _id, not by
 * array position.
 *
 * @returns {number[]} counts, one per baseline bin, then one for out_of_range
 */
export function alignBins(edges, bucketDocs) {
  const nBins = edges.length - 1;
  const counts = new Array(nBins + 1).fill(0);
  const index = new Map(edges.slice(0, -1).map((e, i) => [e, i]));
  for (const d of bucketDocs || []) {
    if (d._id === OUT_OF_RANGE) counts[nBins] += d.n;
    else if (index.has(d._id)) counts[index.get(d._id)] += d.n;
  }
  return counts;
}

/**
 * Population Stability Index:
 *
 *   PSI = sum_i (a_i - e_i) * ln(a_i / e_i)
 *
 * a = live share, e = training share, per bin. Both get a small floor
 * (psiEpsilon) so a bin that was empty at training time does not make the
 * result infinite -- that bin is the most interesting one.
 *
 * @param expectedRatios training shares per bin (+ out_of_range, usually 0)
 * @param actualCounts   live counts per bin (+ out_of_range)
 */
export function psi(expectedRatios, actualCounts) {
  const total = actualCounts.reduce((s, x) => s + x, 0);
  if (total === 0) return { value: null, n: 0 };
  const eps = tuning.psiEpsilon;
  let value = 0;
  for (let i = 0; i < actualCounts.length; i++) {
    const e = Math.max(expectedRatios[i] ?? 0, eps);
    const a = Math.max(actualCounts[i] / total, eps);
    value += (a - e) * Math.log(a / e);
  }
  return { value, n: total };
}

/**
 * Turns the $facet result into one report row per feature.
 */
export function summarizeDrift(baseline, facetResult) {
  const out = [];
  for (const [feature, spec] of Object.entries(baseline)) {
    const contract = facetResult?.[`${feature}__contract`]?.[0] || { n: 0, missing: 0, nulls: 0, nonNumeric: 0 };
    const counts = alignBins(spec.edges, facetResult?.[`${feature}__bins`]);
    const expected = [...spec.ratios, spec.outOfRange ?? 0];
    const { value, n } = psi(expected, counts);
    const total = actualTotal(contract);
    const badShare = total ? (contract.missing + contract.nulls + contract.nonNumeric) / total : 0;

    out.push({
      feature,
      n: total,
      contract: {
        missing: contract.missing,
        nulls: contract.nulls,
        nonNumeric: contract.nonNumeric,
        badShare,
        broken: total > 0 && badShare >= tuning.contractNullRate,
      },
      psi: value,
      band: psiBand(value, n),
      binsLive: counts,
      binsTraining: expected,
      edges: spec.edges,
    });
  }
  return out;
}

const actualTotal = (c) => c.n || 0;

/**
 * Builds the baseline for one feature exactly the way $bucket will bin live
 * data: [lower, upper) intervals, values outside -> out_of_range. Used by the
 * smoke test to prove that the trainer (Python) and the drift check (here)
 * agree on bin semantics. The trainer has the same function in
 * python/common/baseline.py.
 */
export function binIndex(edges, x) {
  if (typeof x !== "number" || x < edges[0] || x >= edges[edges.length - 1]) return edges.length - 1;
  let lo = 0;
  let hi = edges.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x >= edges[mid]) lo = mid;
    else hi = mid;
  }
  return lo;
}
