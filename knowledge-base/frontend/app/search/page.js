"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { resolveWorkspaceId } from "../../lib/workspace";

const EXAMPLES = [
  "How do I chunk documents by markdown section?",
  "When should I use keyword vs vector search?",
  "Why not just sum the scores from two rankers?",
  "What input_type do I use for the user's query?",
];

// Voyage rerank-2 score thresholds. These are empirical defaults for our
// corpus — adjust if you observe scores trending higher or lower.
const STRONG_RELEVANCE = 0.4; // top score above this → high confidence
const WEAK_PASSAGE = 0.3;     // individual passage below this → hide it

function classifyConfidence(passages) {
  if (passages.length === 0) return { label: "none", top: 0 };
  const top = passages[0].rerankScore ?? 0;
  if (top >= STRONG_RELEVANCE) return { label: "strong", top };
  return { label: "weak", top };
}

export default function SearchPage() {
  const params = useSearchParams();
  const initialQ = params.get("q") || "";

  const [workspaceId, setWorkspaceId] = useState(null);
  const [query, setQuery] = useState(initialQ);
  const [passages, setPassages] = useState([]);
  const [answer, setAnswer] = useState("");
  const [model, setModel] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | retrieving | answering | done | error
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    resolveWorkspaceId().then((wsId) => {
      setWorkspaceId(wsId);
      if (initialQ && wsId) run(initialQ, wsId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(q, wsId = workspaceId) {
    if (!wsId) return;
    setQuery(q);
    setAnswer("");
    setPassages([]);
    setModel(null);
    setError(null);
    setPhase("retrieving");

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      await api.chatStream(
        { question: q, workspaceId: wsId, limit: 5 },
        {
          signal: abortRef.current.signal,
          onPassages: (ps) => {
            setPassages(ps);
            setPhase(ps.length === 0 ? "done" : "answering");
          },
          onToken: (t) => setAnswer((prev) => prev + t),
          onDone: (info) => {
            setModel(info.model);
            setPhase("done");
          },
          onError: (msg) => {
            setError(msg);
            setPhase("error");
          },
        },
      );
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err.message);
        setPhase("error");
      }
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (query.trim()) run(query.trim());
  }

  const busy = phase === "retrieving" || phase === "answering";

  return (
    <div>
      <h1>Ask the knowledge base</h1>
      <p className="muted">
        Hybrid retrieval on MongoDB Atlas (keyword + vector) → Voyage rerank →
        OpenAI generates the answer, streamed token by token. Sources cited
        below the answer.
      </p>

      <form onSubmit={onSubmit}>
        <div className="row" style={{ marginTop: "1rem" }}>
          <input
            placeholder="e.g. how do I chunk by section?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            style={{ flex: 1, minWidth: 300, fontSize: "1.05rem" }}
          />
          <button type="submit" disabled={busy || !workspaceId}>
            {busy && <span className="spinner" />}
            Ask
          </button>
        </div>
      </form>

      {phase === "idle" && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="muted small" style={{ margin: 0, marginBottom: 8 }}>
            Try:
          </p>
          <div className="row">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="ghost"
                onClick={() => run(ex)}
                style={{ fontSize: 13 }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="error" style={{ marginTop: "1rem" }}>
          {error}
        </div>
      )}

      {phase === "retrieving" && (
        <p className="muted small" style={{ marginTop: "1rem" }}>
          <span className="spinner" /> running hybrid retrieval on MongoDB…
        </p>
      )}

      {(answer || phase === "answering") && (
        <div
          className="card"
          style={{
            marginTop: "1rem",
            border: "1px solid var(--accent-2)",
            background:
              "linear-gradient(180deg, rgba(0,237,100,0.04), transparent)",
          }}
        >
          <div className="row" style={{ marginBottom: 6 }}>
            <strong
              style={{ fontSize: "0.85rem", color: "var(--accent)" }}
            >
              ✨ AI ANSWER
            </strong>
            {phase === "answering" && (
              <span className="muted small">
                <span className="spinner" /> streaming…
              </span>
            )}
            {phase === "done" && model && (
              <span className="muted small mono">{model}</span>
            )}
          </div>
          <AnswerWithCitations text={answer} passageCount={passages.length} />
        </div>
      )}

      {phase === "done" && passages.length > 0 && (() => {
        const confidence = classifyConfidence(passages);
        // When overall confidence is low, hide every source. Showing weak
        // passages alongside a "low confidence" banner is contradictory:
        // either the system found a useful answer or it didn't.
        // When confidence is strong, only the original-index is preserved
        // (in case any individual passage falls below the weak threshold)
        // so the [N] citations in the answer line up with the source cards.
        const shown =
          confidence.label === "strong"
            ? passages
                .map((p, idx) => ({ p, idx }))
                .filter(({ p }) => (p.rerankScore ?? 0) >= WEAK_PASSAGE)
            : [];
        const hidden = passages.length - shown.length;

        return (
          <>
            {confidence.label === "weak" && (
              <div
                className="card"
                style={{
                  marginTop: "1rem",
                  background: "rgba(234, 179, 8, 0.08)",
                  border: "1px solid rgba(234, 179, 8, 0.4)",
                }}
              >
                <p style={{ margin: 0, fontSize: 14 }}>
                  <strong style={{ color: "#eab308" }}>
                    ⚠ Low confidence
                  </strong>
                  <span className="muted" style={{ marginLeft: 8 }}>
                    Top rerank score is{" "}
                    <code className="mono">
                      {confidence.top.toFixed(3)}
                    </code>
                    , below our threshold of{" "}
                    <code className="mono">{STRONG_RELEVANCE}</code>. The
                    knowledge base does not appear to cover this topic, so
                    no sources are shown. <code className="mono">$vectorSearch</code>{" "}
                    always returns the nearest neighbors in vector space,
                    even when none of them is actually relevant.
                  </span>
                </p>
              </div>
            )}

            {shown.length > 0 && (
              <h2 style={{ marginTop: "2rem" }}>
                Sources{" "}
                <span className="muted small">
                  · {shown.length} passage{shown.length === 1 ? "" : "s"}
                  {hidden > 0 &&
                    ` (${hidden} weaker match${hidden === 1 ? "" : "es"} hidden)`}
                </span>
              </h2>
            )}

            {shown.map(({ p, idx }) => (
              <article
                key={p._id}
                id={`source-${idx + 1}`}
                className="card"
                style={{ scrollMarginTop: 16 }}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <Link href={`/articles/${p.articleId}`}>
                    <strong>
                      <span className="result-score" style={{ marginRight: 8 }}>
                        [{idx + 1}]
                      </span>
                      {p.title}
                    </strong>
                  </Link>
                  <span className="result-score">
                    rerank {(p.rerankScore ?? 0).toFixed(3)}
                  </span>
                </div>
                <pre
                  className="content"
                  style={{
                    marginTop: "0.5rem",
                    marginBottom: "0.4rem",
                    fontSize: 13.5,
                  }}
                >
                  {p.text}
                </pre>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    {(p.tags || []).slice(0, 6).map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                  <span className="small muted">
                    chunk #{p.chunkIndex}
                    {p.kwMatch ? " · keyword + vector" : " · vector"}
                  </span>
                </div>
              </article>
            ))}
          </>
        );
      })()}
    </div>
  );
}

/**
 * Replaces inline [N] tokens in the answer with links that scroll-to the
 * corresponding source card. Tolerant of partial brackets during streaming.
 */
function AnswerWithCitations({ text, passageCount }) {
  const parts = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= passageCount) {
      parts.push(
        <a
          key={`cite-${m.index}`}
          href={`#source-${n}`}
          className="result-score"
          style={{ margin: "0 2px", textDecoration: "none" }}
          onClick={(e) => {
            const el = document.getElementById(`source-${n}`);
            if (el) {
              e.preventDefault();
              el.scrollIntoView({ behavior: "smooth", block: "start" });
              el.style.outline = "1px solid var(--accent)";
              setTimeout(() => (el.style.outline = ""), 1200);
            }
          }}
        >
          [{n}]
        </a>,
      );
    } else {
      parts.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return (
    <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
      {parts}
    </p>
  );
}
