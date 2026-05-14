/**
 * Markdown-aware semantic chunker.
 *
 * Strategy
 * ────────
 * 1. Parse the document into sections defined by ATX headings (# .. ######).
 * 2. Each section becomes ONE chunk, prefixed with its breadcrumb so the
 *    embedding model knows where the text lives in the hierarchy:
 *
 *      "Article title > Section > Subsection
 *
 *       …body of the subsection…"
 *
 * 3. If a section is larger than `maxChunkSize`, fall back to paragraph
 *    splitting (then sentence splitting) for THAT section only, keeping the
 *    breadcrumb on every sub-chunk so retrieval still knows where the text
 *    came from.
 * 4. If the document has no headings at all, fall back to paragraph/sentence
 *    chunking on the whole thing.
 *
 * Why
 * ───
 * Fixed-character windows like "every 800 chars" cut mid-sentence and mix
 * topics from different sections into the same embedding. Section-based
 * chunks are coherent units of meaning — one vector per topic — which
 * dramatically improves retrieval precision and the readability of `/ask`
 * results.
 */

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE = /^```/;

const DEFAULT_MAX = 1500;        // characters; sections bigger than this get split
const SENTENCE_MIN_RATIO = 0.5;  // when walking back to a sentence break,
                                 // accept anything past half the window

/**
 * Public API. Returns an array of chunk strings.
 *
 * @param {string} text
 * @param {{ chunkSize?: number }} [opts]
 * @returns {string[]}
 */
export function chunkText(text, opts = {}) {
  const maxSize = opts.chunkSize ?? DEFAULT_MAX;
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  // No ATX headings anywhere → fall back to paragraph splitting.
  if (!/^#{1,6}\s/m.test(clean)) {
    return splitByParagraph(clean, maxSize);
  }

  const sections = parseSections(clean);
  const chunks = [];

  for (const section of sections) {
    const breadcrumb = buildBreadcrumb(section);
    const body = section.body
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!body && !breadcrumb) continue;

    if (!body) {
      // Heading with no body — still emit so it's searchable.
      chunks.push(breadcrumb);
      continue;
    }

    const prefix = breadcrumb ? `${breadcrumb}\n\n` : "";
    const full = `${prefix}${body}`;

    if (full.length <= maxSize) {
      chunks.push(full);
      continue;
    }

    // Section is bigger than the budget: split the body, keep breadcrumb
    // on every sub-chunk so retrieval still knows the context.
    const budget = Math.max(200, maxSize - prefix.length);
    const sub = splitByParagraph(body, budget);
    for (const piece of sub) {
      chunks.push(`${prefix}${piece}`);
    }
  }

  return chunks.filter((c) => c.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Section parser                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Walks the document line by line and collects sections.
 * Each section carries:
 *   - level    (1..6, or 0 for the implicit "intro" before the first heading)
 *   - heading  (heading text, or null for the intro)
 *   - parents  (ancestors above this one in the tree)
 *   - body     (lines between this heading and the next)
 *
 * Fenced code blocks are skipped so a "# comment" line inside ```bash``` is
 * not treated as a heading.
 */
function parseSections(text) {
  const lines = text.split("\n");
  const sections = [];
  const stack = []; // active ancestors
  let current = { level: 0, heading: null, parents: [], body: [] };
  let inFence = false;

  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      current.body.push(line);
      continue;
    }

    const match = !inFence && line.match(HEADING);
    if (!match) {
      current.body.push(line);
      continue;
    }

    // New heading: close the previous section (if it had content) and start fresh.
    if (current.heading !== null || current.body.some((l) => l.trim())) {
      sections.push(current);
    }

    const level = match[1].length;
    const heading = match[2].trim();

    // Pop ancestors at this depth or deeper before pushing the new one.
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    const parents = stack.map((s) => ({ level: s.level, heading: s.heading }));
    stack.push({ level, heading });

    current = { level, heading, parents, body: [] };
  }

  if (current.heading !== null || current.body.some((l) => l.trim())) {
    sections.push(current);
  }

  return sections;
}

function buildBreadcrumb(section) {
  const crumbs = [
    ...section.parents.map((p) => p.heading),
    section.heading,
  ].filter(Boolean);
  return crumbs.join(" > ");
}

/* -------------------------------------------------------------------------- */
/* Fallback splitting (sections > maxSize or heading-less docs)               */
/* -------------------------------------------------------------------------- */

function splitByParagraph(text, maxSize) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let buf = "";

  for (const p of paragraphs) {
    const candidate = buf ? `${buf}\n\n${p}` : p;
    if (candidate.length <= maxSize) {
      buf = candidate;
      continue;
    }
    if (buf) out.push(buf);

    if (p.length <= maxSize) {
      buf = p;
    } else {
      const sentences = splitBySentence(p, maxSize);
      for (let i = 0; i < sentences.length - 1; i++) out.push(sentences[i]);
      buf = sentences[sentences.length - 1] || "";
    }
  }
  if (buf) out.push(buf);
  return out;
}

function splitBySentence(text, maxSize) {
  const out = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxSize, text.length);

    if (end < text.length) {
      const window = text.slice(start, end);
      const lastBreak = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
        window.lastIndexOf("\n"),
      );
      if (lastBreak > maxSize * SENTENCE_MIN_RATIO) {
        end = start + lastBreak + 1;
      }
    }

    out.push(text.slice(start, end).trim());
    start = end;
  }
  return out.filter(Boolean);
}
