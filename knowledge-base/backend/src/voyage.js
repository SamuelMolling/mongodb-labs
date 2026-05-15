/**
 * Minimal Voyage AI client — defaults to the MongoDB-managed gateway.
 *
 * MongoDB acquired Voyage AI and now exposes the same embedding + rerank
 * models behind a managed endpoint:
 *
 *   POST https://ai.mongodb.com/v1/embeddings
 *   POST https://ai.mongodb.com/v1/rerank
 *
 * Auth uses a "Model API Key" (prefix `al-`) created in
 * Atlas → Organization → Access Manager → Model API Keys.
 *
 * Want the legacy direct Voyage endpoint instead? Set
 *   VOYAGE_BASE_URL=https://api.voyageai.com/v1
 * in your .env and use a `pa-` prefixed key from https://dash.voyageai.com.
 *
 * We use fetch directly (no SDK) so the article reader can see exactly
 * which HTTP calls are made.
 *
 * Docs: https://www.mongodb.com/docs/voyageai/api-reference/overview/
 */

const DEFAULT_BASE = "https://ai.mongodb.com/v1";

function baseUrl() {
  return process.env.VOYAGE_BASE_URL || DEFAULT_BASE;
}

function getKey() {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set");
  return key;
}

/**
 * Wraps a non-2xx response with a helpful diagnostic instead of the raw body.
 */
async function explainError(res, label) {
  const body = await res.text();
  const hints = [];
  if (res.status === 401) {
    hints.push("API key was not recognised by the gateway.");
    hints.push("Generate a Model API Key in Atlas → Access Manager → Model API Keys.");
  } else if (res.status === 403) {
    hints.push("Key recognised but not authorised. Check billing / payment method on the Atlas org.");
    hints.push("Or: key belongs to a different org/project than the requested model.");
  } else if (res.status === 429) {
    hints.push("Rate-limited (TPM or RPM). Lower --concurrency or retry with backoff.");
  } else if (res.status === 400) {
    hints.push("Bad request — model name? input too long? Check VOYAGE_EMBEDDING_MODEL.");
  }
  const tail = hints.length ? `\n  hint: ${hints.join("\n  hint: ")}` : "";
  return new Error(
    `${label} failed (${res.status} ${res.statusText}) @ ${baseUrl()}\n  body: ${body}${tail}`,
  );
}

/**
 * Generates embeddings for one or many texts.
 * @param {string|string[]} input  Single text or batch of texts.
 * @param {"document"|"query"} inputType  Document vs query embeddings.
 * @returns {Promise<number[][]>}  One vector per input.
 */
export async function embed(input, inputType = "document") {
  const model = process.env.VOYAGE_EMBEDDING_MODEL || "voyage-3";
  const texts = Array.isArray(input) ? input : [input];

  const res = await fetch(`${baseUrl()}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getKey()}`,
    },
    body: JSON.stringify({
      model,
      input: texts,
      input_type: inputType,
    }),
  });

  if (!res.ok) throw await explainError(res, "embed");

  const json = await res.json();
  return json.data.map((d) => d.embedding);
}

/**
 * Reranks documents against a query. Returns the documents in new order
 * with their relevance scores. Used as a post-retrieval step to boost
 * precision after Atlas Vector Search returns candidates.
 *
 * @param {string} query
 * @param {string[]} documents
 * @param {number} topK  How many to return after reranking.
 * @returns {Promise<{index: number, relevance_score: number}[]>}
 */
export async function rerank(query, documents, topK = 5) {
  if (documents.length === 0) return [];

  const model = process.env.VOYAGE_RERANK_MODEL || "rerank-2";

  const res = await fetch(`${baseUrl()}/rerank`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getKey()}`,
    },
    body: JSON.stringify({
      model,
      query,
      documents,
      top_k: Math.min(topK, documents.length),
      return_documents: false,
    }),
  });

  if (!res.ok) throw await explainError(res, "rerank");

  const json = await res.json();
  return json.data;
}
