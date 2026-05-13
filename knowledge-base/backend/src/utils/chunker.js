/**
 * Splits long article text into overlapping chunks for embedding.
 *
 * Why chunks instead of embedding the whole article?
 *  - Embedding models have a max token window.
 *  - Semantic search is more precise at paragraph granularity than at
 *    document granularity — the user finds the *passage* that answers
 *    their question, not just the article that contains it.
 *  - We store the embedding on the chunk, then $lookup the parent article
 *    to render results.
 */

const DEFAULT_CHUNK_SIZE = 800;   // characters
const DEFAULT_OVERLAP = 120;      // characters

export function chunkText(text, {
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP,
} = {}) {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= chunkSize) return [clean];

  const chunks = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);

    // Try not to break mid-sentence: walk back to the nearest boundary.
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const lastBreak = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
      );
      if (lastBreak > chunkSize * 0.5) {
        end = start + lastBreak + 1;
      }
    }

    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - overlap;
  }

  return chunks.filter((c) => c.length > 0);
}
