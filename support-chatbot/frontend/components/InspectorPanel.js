"use client";

/**
 * The pipeline, live.
 *
 * The answer is the boring half of this lab. The interesting half is what
 * happened before the first token: what the turn was rewritten into, whether
 * retrieval ran at all, which corpus won, and how confident the top passage
 * was. All of that is invisible in a normal chat UI, which is exactly why
 * agents are hard to debug.
 */

const STAGES = [
  ["condensing", "condense"],
  ["tools", "tools"],
  ["retrieving", "retrieve"],
  ["generating", "generate"],
];

/**
 * Bands come from the server with the passages. Hardcoding them here means
 * two sources of truth for one decision, and the copy that is not next to
 * the retrieval code is the one that goes stale.
 */
function bandOf(score, thresholds) {
  if (typeof score !== "number") return "none";
  if (!thresholds) return "none";
  if (score >= thresholds.strong) return "strong";
  if (score >= thresholds.weak) return "weak";
  return "none";
}

export function InspectorPanel({ turn }) {
  if (!turn) {
    return (
      <aside className="inspector">
        <h2>Inspector</h2>
        <div className="block muted">Send a message to watch the pipeline run.</div>
      </aside>
    );
  }

  const { stage, condensed, passages, stats, done, escalation, skipped, thresholds } = turn;
  const band = done?.confidence ?? bandOf(turn.topScore, thresholds);

  return (
    <aside className="inspector">
      <h2>Inspector</h2>

      <div className="block">
        <h3>pipeline</h3>
        <div className="stages">
          {STAGES.map(([key, label]) => {
            const isSkipped = key === "retrieving" && skipped;
            const reached = stageIndex(stage) >= stageIndex(key);
            const active = stage === key && !done;
            return (
              <span
                key={key}
                className={`stage ${isSkipped ? "skipped" : active ? "active" : reached || done ? "done" : ""}`}
              >
                {label}
              </span>
            );
          })}
        </div>
      </div>

      {condensed && (
        <div className="block">
          <h3>condensation</h3>
          <div className="condensed">{condensed.condensedQuestion}</div>
          <div style={{ marginTop: ".55rem" }}>
            <Row k="intent" v={condensed.intent} />
            <Row k="sentiment" v={condensed.sentiment} />
            <Row k="retrieval" v={condensed.needsRetrieval ? "yes" : "skipped"} />
            <Row
              k="tools"
              v={condensed.needsTools?.length ? condensed.needsTools.join(", ") : "none"}
            />
            {condensed.degraded && <Row k="classifier" v="degraded" />}
          </div>
        </div>
      )}

      {(done || turn.topScore != null) && (
        <div className="block">
          <h3>confidence</h3>
          <div className="kv">
            <span className="k">top rerank</span>
            <span className={`v score ${band}`}>
              {typeof (done?.topRerankScore ?? turn.topScore) === "number"
                ? (done?.topRerankScore ?? turn.topScore).toFixed(3)
                : "—"}{" "}
              {band}
            </span>
          </div>
          {done && <Row k="failed turns" v={String(done.failedTurns ?? 0)} />}
          {done?.model && <Row k="model" v={done.model} />}
        </div>
      )}

      {passages?.length > 0 && (
        <div className="block">
          <h3>
            passages ({passages.length}
            {stats ? ` of ${stats.fused ?? "?"} fused` : ""})
          </h3>
          {passages.map((p, i) => (
            <div className="passage" key={p.id || i}>
              <div className="head">
                <span className={`kind ${p.kind}`}>{p.kind}</span>
                <span className="title">{p.title}</span>
                <span
                  className={`score ${bandOf(p.rerankScore, thresholds)}`}
                  style={{ marginLeft: "auto" }}
                >
                  {p.rerankScore?.toFixed(3)}
                </span>
              </div>
              {p.breadcrumb && <div className="crumb">{p.breadcrumb}</div>}
            </div>
          ))}
        </div>
      )}

      {stats && (
        <div className="block">
          <h3>rankers</h3>
          <Row k="kb articles (bm25)" v={String(stats.articles ?? 0)} />
          <Row k="kb chunks (vector)" v={String(stats.chunks ?? 0)} />
          <Row k="tickets (vector)" v={String(stats.tickets ?? 0)} />
          <Row k="fused" v={String(stats.fused ?? 0)} />
        </div>
      )}

      {escalation && (
        <div className="block">
          <h3>handoff packet</h3>
          <Row k="reason" v={escalation.reason} />
          <pre className="packet">{JSON.stringify(escalation.packet, null, 2)}</pre>
        </div>
      )}
    </aside>
  );
}

function Row({ k, v }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

function stageIndex(stage) {
  const order = ["condensing", "condensed", "tools", "retrieving", "retrieval_skipped", "generating"];
  const i = order.indexOf(stage);
  return i === -1 ? -1 : i;
}
