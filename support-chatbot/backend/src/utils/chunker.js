/**
 * Markdown-aware semantic chunker (adapted from the `knowledge-base` lab).
 *
 * Strategy
 * --------
 * 1. Parse the document into sections defined by ATX headings (# .. ######).
 * 2. Each section becomes ONE chunk, prefixed with its breadcrumb so the
 *    embedding model knows where the text lives in the hierarchy:
 *
 *      "SAML SSO > Pricing
 *
 *       ...body of the subsection..."
 *
 * 3. Sections larger than `maxChunkSize` fall back to paragraph splitting,
 *    then sentence splitting, then a hard window -- keeping the breadcrumb on
 *    every sub-chunk.
 * 4. Documents with no headings fall back to paragraph/sentence chunking.
 *
 * Why breadcrumbs
 * ---------------
 * A chunk that reads "Set the assertion consumer URL to the value shown in
 * the console" is nearly meaningless on its own, and its embedding sits in
 * whatever region of vector space generic setup instructions live in. The
 * breadcrumb is what makes it retrievable for "how do I configure SAML".
 *
 * That is also why the breadcrumb is an INVARIANT here, not a nicety: no
 * chunk is ever emitted without one. A single context-free sub-chunk is
 * invisible to retrieval, and it fails silently -- it just never comes back.
 */

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE = /^\s*```/;

const DEFAULT_MAX = 1500;
const SENTENCE_MIN_RATIO = 0.5; // when walking back to a sentence break,
                                // accept anything past half the window

/**
 * Chunks one article. The article title is always the root of the breadcrumb.
 *
 * @param {string} title    Article title -- becomes the breadcrumb root.
 * @param {string} content  Markdown body.
 * @param {{ maxChunkSize?: number }} [opts]
 * @returns {{ chunkIndex: number, breadcrumb: string, text: string }[]}
 */
export function chunkArticle(title, content, opts = {}) {
  const maxSize = opts.maxChunkSize ?? DEFAULT_MAX;
  const root = String(title || "").trim();
  const clean = String(content || "").replace(/\r\n/g, "\n").trim();

  if (!clean) return [];

  const out = [];
  const push = (breadcrumb, body) => {
    const prefix = `${breadcrumb}\n\n`;
    // Reserve room for the breadcrumb so the finished chunk -- prefix
    // included -- respects maxSize. Callers budget embedding cost against
    // the chunk they actually store, not the body we happened to split.
    const budget = maxSize - prefix.length;
    for (const piece of splitByParagraph(body, budget)) {
      out.push({
        chunkIndex: out.length,
        breadcrumb,
        text: `${prefix}${piece}`,
      });
    }
  };

  // No ATX headings anywhere -> the whole document sits under the title.
  if (!/^#{1,6}\s/m.test(clean)) {
    push(compressBreadcrumb(root, maxSize), clean);
    return out;
  }

  for (const section of parseSections(clean)) {
    const breadcrumb = compressBreadcrumb(
      buildBreadcrumb(root, section),
      maxSize,
    );
    const body = section.body
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // A heading with no body still describes something -- emit the
    // breadcrumb alone so the section title itself stays searchable.
    if (!body) {
      out.push({ chunkIndex: out.length, breadcrumb, text: breadcrumb });
      continue;
    }

    push(breadcrumb, body);
  }

  return out;
}

/**
 * Raw chunking without an article root. Kept for callers that just want the
 * strings (and to keep parity with the knowledge-base lab's API).
 */
export function chunkText(text, opts = {}) {
  return chunkArticle("", text, opts).map((c) => c.text);
}

/* -------------------------------------------------------------------------- */
/* Section parser                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Walks the document line by line and collects sections.
 *
 * Fenced code blocks are tracked so a "# rebuild the index" comment inside
 * ```bash``` is not mistaken for a heading. Getting this wrong is quietly
 * destructive: the fence's contents get torn into fragments, and half a shell
 * script embeds as if it were prose.
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

    // New heading: close the previous section (if it had content).
    if (current.heading !== null || current.body.some((l) => l.trim())) {
      sections.push(current);
    }

    const level = match[1].length;
    const heading = match[2].trim();

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

/**
 * Joins article title + ancestor headings + this heading.
 *
 * Articles routinely open with an H1 that repeats the title. Naively joining
 * produces "SAML SSO > SAML SSO > Pricing", which wastes prompt budget and
 * skews the embedding toward whatever word got repeated. Adjacent duplicates
 * are collapsed case-insensitively.
 */
function buildBreadcrumb(root, section) {
  const crumbs = [
    root,
    ...section.parents.map((p) => p.heading),
    section.heading,
  ].filter((c) => c && c.trim());

  const deduped = [];
  for (const crumb of crumbs) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.trim().toLowerCase() === crumb.trim().toLowerCase()) continue;
    deduped.push(crumb.trim());
  }
  return deduped.join(" > ");
}

/**
 * A deeply nested breadcrumb can eat the chunk budget it was meant to
 * annotate. Past a third of the window, keep the ends and elide the middle --
 * the root and the leaf carry nearly all the retrieval signal.
 */
function compressBreadcrumb(breadcrumb, maxSize) {
  const limit = Math.floor(maxSize / 3);
  if (breadcrumb.length <= limit) return breadcrumb;

  const parts = breadcrumb.split(" > ");
  if (parts.length <= 2) return breadcrumb.slice(0, limit);

  return `${parts[0]} > ... > ${parts[parts.length - 1]}`.slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Fallback splitting                                                         */
/* -------------------------------------------------------------------------- */

function splitByParagraph(text, maxSize) {
  const size = Math.max(80, maxSize);
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let buf = "";

  for (const p of paragraphs) {
    const candidate = buf ? `${buf}\n\n${p}` : p;
    if (candidate.length <= size) {
      buf = candidate;
      continue;
    }
    if (buf) out.push(buf);

    if (p.length <= size) {
      buf = p;
    } else {
      const sentences = splitBySentence(p, size);
      for (let i = 0; i < sentences.length - 1; i++) out.push(sentences[i]);
      buf = sentences[sentences.length - 1] || "";
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [text.slice(0, size)];
}

/**
 * Sentence-aware window with a hard ceiling.
 *
 * The window is cut at `maxSize` FIRST and only then walked back to a
 * sentence boundary. Doing it the other way round -- find sentences, emit
 * each one -- looks tidier and breaks on real input: a minified JSON blob or
 * a wide Markdown table row contains no sentence terminator at all, so it is
 * "one sentence" of 12k characters and sails straight past the budget into
 * the embedding call, where it is silently truncated by the provider.
 */
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
      // Only honour the boundary if it is late enough in the window to be
      // worth the shorter chunk; otherwise take the hard cut.
      if (lastBreak > maxSize * SENTENCE_MIN_RATIO) {
        end = start + lastBreak + 1;
      }
    }

    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
  }

  return out.filter(Boolean);
}
