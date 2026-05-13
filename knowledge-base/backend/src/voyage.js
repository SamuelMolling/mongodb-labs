/**
 * Minimal Voyage AI client.
 *
 * We deliberately use fetch directly instead of an SDK so the article reader
 * can see exactly which HTTP calls are made.
 *
 * Docs: https://docs.voyageai.com
 */

const VOYAGE_BASE = "https://api.voyageai.com/v1";

function getKey() {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set");
  return key;
}

/**
 * Generates embeddings for one or many texts.
 * @param {string|string[]} input  Single text or batch of texts.
 * @param {"document"|"query"} inputType  Voyage distinguishes document vs query embeddings.
 * @returns {Promise<number[][]>}  One vector per input.
 */
export async function embed(input, inputType = "document") {
  const model = process.env.VOYAGE_EMBEDDING_MODEL || "voyage-3";
  const texts = Array.isArray(input) ? input : [input];

  const res = await fetch(`${VOYAGE_BASE}/embeddings`, {
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Voyage embed failed (${res.status}): ${text}`);
  }

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

  const res = await fetch(`${VOYAGE_BASE}/rerank`, {
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Voyage rerank failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  return json.data;
}
