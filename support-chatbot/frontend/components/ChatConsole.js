"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { InspectorPanel } from "./InspectorPanel";
import { CustomerPicker } from "./CustomerPicker";

const SUGGESTIONS = [
  "How do I export the audit log?",
  "How do I set up SAML SSO?",
  "I get bounced back to the login page after signing in with Okta",
  "Where is my order ORD-1042?",
];

export function ChatConsole() {
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState(null);
  const [conversationId, setConversationId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [turn, setTurn] = useState(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const transcriptRef = useRef(null);

  useEffect(() => {
    api
      .listCustomers()
      .then((list) => {
        setCustomers(list);
        // Default to the enterprise customer so the first question shows the
        // richest result; switching to free is the interesting comparison.
        const enterprise = list.find((c) => c.plan === "enterprise");
        if (enterprise) setCustomerId(enterprise._id);
      })
      .catch((err) => setError(`Could not load customers: ${err.message}`));
  }, []);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /**
   * Switching customer starts a NEW conversation on purpose. Carrying a
   * transcript across an identity change would mean answering a Free
   * customer with an Enterprise passage retrieved a turn earlier — the
   * entitlement filter guards retrieval, not memory.
   */
  function switchCustomer(id) {
    setCustomerId(id);
    setConversationId(null);
    setMessages([]);
    setTurn(null);
  }

  async function send(text) {
    const message = (text ?? input).trim();
    if (!message || busy) return;

    setError(null);
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: message }]);

    // One turn's worth of inspector state.
    const live = { stage: "condensing", passages: [], skipped: false };
    setTurn({ ...live });

    let answer = "";
    setMessages((m) => [...m, { role: "assistant", content: "", pending: true }]);

    const patchAnswer = (content, extra = {}) =>
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: "assistant", content, ...extra };
        return next;
      });

    try {
      await api.chatStream(
        { message, conversationId, customerId },
        {
          onState: (evt) => {
            if (evt.conversationId) setConversationId(evt.conversationId);

            if (evt.stage === "condensed") {
              live.condensed = evt;
              live.stage = "tools";
            } else if (evt.stage === "retrieval_skipped") {
              live.skipped = true;
              live.stage = "generating";
            } else {
              live.stage = evt.stage;
            }
            setTurn({ ...live });
          },
          onPassages: (evt) => {
            live.passages = evt.passages || [];
            live.stats = evt.stats;
            live.thresholds = evt.thresholds;
            live.topScore = live.passages[0]?.rerankScore ?? null;
            setTurn({ ...live });
          },
          onToken: (text) => {
            answer += text;
            patchAnswer(answer, { pending: true });
          },
          onEscalation: (evt) => {
            live.escalation = evt;
            setTurn({ ...live });
          },
          onDone: (evt) => {
            live.done = evt;
            setTurn({ ...live });
            patchAnswer(answer, {
              confidence: evt.confidence,
              escalated: evt.escalated,
              topRerankScore: evt.topRerankScore,
            });
          },
          onError: (msg) => setError(msg),
        },
      );
    } catch (err) {
      setError(err.message);
      patchAnswer(answer || "—");
    } finally {
      setBusy(false);
    }
  }

  const last = messages[messages.length - 1];
  const showLowConfidence =
    last?.role === "assistant" && !last.pending && last.confidence === "none" && !last.escalated;

  return (
    <>
      <header className="topbar">
        <span className="brand">
          <span className="dot" />
          Support Agent
        </span>
        <span className="muted small">MongoDB Atlas · condense → tools → retrieve → generate</span>
        <span className="spacer" />
        <CustomerPicker
          customers={customers}
          value={customerId}
          onChange={switchCustomer}
          disabled={busy}
        />
      </header>

      <div className="workspace">
        <section className="chat">
          <div className="transcript" ref={transcriptRef}>
            {messages.length === 0 && (
              <div className="empty">
                <p>Ask the agent something. The panel on the right shows the pipeline.</p>
                <ul>
                  {SUGGESTIONS.map((s) => (
                    <li key={s}>
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          send(s);
                        }}
                      >
                        {s}
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="small">
                  Ask the audit-log question as the Enterprise customer, then switch to Free
                  and ask it again.
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <div className={`msg ${m.role}`} key={i}>
                <div className="bubble">
                  {m.content || (m.pending ? "…" : "")}
                </div>
                {m.role === "assistant" && !m.pending && m.confidence && (
                  <div className="meta">
                    confidence {m.confidence}
                    {typeof m.topRerankScore === "number"
                      ? ` · top ${m.topRerankScore.toFixed(3)}`
                      : ""}
                  </div>
                )}
              </div>
            ))}

            {turn?.escalation && (
              <div className="banner escalation">
                Handed off to a human — <span className="mono">{turn.escalation.reason}</span>.
                The packet is in the inspector.
              </div>
            )}

            {showLowConfidence && (
              <div className="banner lowconf">
                Confidence collapsed: nothing retrieved cleared the threshold, so the agent
                said it does not know instead of filling the gap.
              </div>
            )}

            {error && <div className="banner lowconf">{error}</div>}
          </div>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={busy ? "thinking…" : "Ask about SSO, an order, billing…"}
              disabled={busy}
              autoFocus
            />
            <button type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </section>

        <InspectorPanel turn={turn} />
      </div>
    </>
  );
}
