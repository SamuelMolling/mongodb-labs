/**
 * Synthetic article generator.
 *
 * The goal is to produce *thousands* of plausible articles for a load test
 * of Atlas Search and Vector Search — not to write good prose. Articles are
 * assembled from a topic + technology + problem-statement matrix, so search
 * queries actually return interesting variation across modes.
 */

const TOPICS = [
  { slug: "mongodb",         name: "MongoDB",            tags: ["mongodb", "database"] },
  { slug: "atlas-search",    name: "Atlas Search",       tags: ["mongodb", "atlas-search", "search"] },
  { slug: "vector-search",   name: "Atlas Vector Search",tags: ["mongodb", "vector-search", "embeddings"] },
  { slug: "rag",             name: "Retrieval Augmented Generation", tags: ["rag", "llm", "embeddings"] },
  { slug: "embeddings",      name: "Embeddings",         tags: ["embeddings", "ai"] },
  { slug: "rerank",          name: "Reranking",          tags: ["rerank", "search", "voyage-ai"] },
  { slug: "rrf",             name: "Reciprocal Rank Fusion", tags: ["rrf", "hybrid-search"] },
  { slug: "chunking",        name: "Document Chunking",  tags: ["chunking", "rag"] },
  { slug: "node",            name: "Node.js",            tags: ["node", "javascript", "backend"] },
  { slug: "nextjs",          name: "Next.js",            tags: ["nextjs", "react", "frontend"] },
  { slug: "react",           name: "React",              tags: ["react", "frontend"] },
  { slug: "docker",          name: "Docker",             tags: ["docker", "devops"] },
  { slug: "kubernetes",      name: "Kubernetes",         tags: ["kubernetes", "devops"] },
  { slug: "kafka",           name: "Kafka",              tags: ["kafka", "events", "streaming"] },
  { slug: "redis",           name: "Redis",              tags: ["redis", "cache"] },
  { slug: "graphql",         name: "GraphQL",            tags: ["graphql", "api"] },
  { slug: "auth",            name: "Authentication",     tags: ["auth", "security"] },
  { slug: "rate-limiting",   name: "Rate Limiting",      tags: ["rate-limiting", "api"] },
  { slug: "observability",   name: "Observability",      tags: ["observability", "monitoring"] },
  { slug: "tracing",         name: "Distributed Tracing",tags: ["tracing", "observability"] },
  { slug: "ci-cd",           name: "CI/CD",              tags: ["ci-cd", "devops"] },
  { slug: "terraform",       name: "Terraform",          tags: ["terraform", "iac"] },
  { slug: "postgres",        name: "PostgreSQL",         tags: ["postgres", "database"] },
  { slug: "sharding",        name: "Sharding",           tags: ["sharding", "scalability"] },
  { slug: "replication",     name: "Replica Sets",       tags: ["replication", "mongodb"] },
  { slug: "indexes",         name: "Indexes",            tags: ["indexes", "performance"] },
  { slug: "transactions",    name: "Transactions",       tags: ["transactions", "consistency"] },
  { slug: "change-streams",  name: "Change Streams",     tags: ["change-streams", "mongodb"] },
  { slug: "schema-design",   name: "Schema Design",      tags: ["schema-design", "modeling"] },
  { slug: "aggregation",     name: "Aggregation Framework", tags: ["aggregation", "mongodb"] },
];

const FORMATS = [
  "tutorial",
  "guide",
  "deep-dive",
  "cookbook",
  "comparison",
  "troubleshooting",
  "reference",
  "post-mortem",
  "concept",
  "design-doc",
];

const ANGLES = [
  "how to use",
  "scaling",
  "debugging",
  "monitoring",
  "migrating from",
  "best practices for",
  "common pitfalls in",
  "production lessons from",
  "benchmarking",
  "comparing options for",
  "securing",
  "automating",
  "cost-optimising",
  "designing schemas for",
  "introducing your team to",
];

const AUDIENCES = [
  "engineers new to",
  "senior backend developers using",
  "DBAs evaluating",
  "platform teams adopting",
  "small teams that just deployed",
  "startup CTOs choosing",
];

const PROBLEMS = [
  "slow queries on large collections",
  "hot-spotted shard keys",
  "drifting embeddings between systems",
  "search results that miss synonyms",
  "BM25 scores dominated by spam tokens",
  "cold starts on serverless functions",
  "cost runaway from over-eager batching",
  "memory pressure on the primary",
  "cache stampedes after deploys",
  "noisy neighbours in multi-tenant setups",
  "drift between dev and prod indexes",
  "embedding model upgrades",
  "long tail queries returning empty results",
  "rerankers blowing the latency budget",
  "stale results after a write",
];

const SOLUTIONS = [
  "we introduced a covered compound index",
  "we switched to hashed shard keys",
  "we co-located embeddings with operational data",
  "we used a language-aware analyzer",
  "we added a custom synonyms mapping",
  "we moved heavy work to a background worker",
  "we batched embedding calls to 96 inputs",
  "we pre-filtered candidates inside $vectorSearch",
  "we added an LRU cache in front of the reranker",
  "we used change streams to invalidate caches",
  "we tagged documents with workspaceId and filtered on it",
  "we re-embedded only on title/content edits",
  "we cut chunks at sentence boundaries instead of fixed offsets",
  "we ran $search and $vectorSearch in parallel and fused with RRF",
  "we increased numCandidates and capped limit",
];

const TAKEAWAYS = [
  "the result was a 4x latency improvement at p95",
  "we cut our infra bill by roughly a third",
  "we removed an entire service from the stack",
  "we stopped paging on Friday nights",
  "the team onboarding doc shrank from 12 pages to 2",
  "we shipped the next feature in days instead of weeks",
  "search recall jumped from 0.62 to 0.88",
  "p99 dropped under 200 ms",
];

const SECTIONS = [
  "Background",
  "What we tried first",
  "Why that approach failed",
  "The fix",
  "Implementation",
  "Trade-offs",
  "Results",
  "What we'd do differently",
];

/* -------------------------------------------------------------------------- */
/* deterministic-ish RNG for reproducible seeds                               */
/* -------------------------------------------------------------------------- */

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function pickN(rng, arr, n) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length > 0) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* article composition                                                        */
/* -------------------------------------------------------------------------- */

function makeParagraph(rng, primary, secondary) {
  const problem = pick(rng, PROBLEMS);
  const solution = pick(rng, SOLUTIONS);
  const takeaway = pick(rng, TAKEAWAYS);

  const intros = [
    `Teams using ${primary.name} together with ${secondary.name} often run into ${problem}.`,
    `One pattern we see often with ${primary.name} is ${problem}, especially when ${secondary.name} is involved.`,
    `If you operate ${primary.name} at scale, you've probably hit ${problem}.`,
    `${primary.name} works well in isolation, but combining it with ${secondary.name} can surface ${problem}.`,
  ];

  const transitions = [
    "After a few iterations,",
    "Once we instrumented the path,",
    "The breakthrough came when",
    "Looking at the traces showed",
    "After reviewing the metrics,",
  ];

  return `${pick(rng, intros)} ${pick(rng, transitions)} ${solution}. In our case, ${takeaway}.`;
}

function makeCodeBlock(rng, topic) {
  const examples = {
    "mongodb": `db.${topic.slug.replace(/-/g, "_")}.aggregate([\n  { $match: { workspaceId } },\n  { $sort: { updatedAt: -1 } },\n  { $limit: 50 }\n])`,
    "atlas-search": `db.articles.aggregate([\n  { $search: { index: "articles_search", text: { query, path: "content" } } }\n])`,
    "vector-search": `db.chunks.aggregate([\n  { $vectorSearch: { index: "chunks_vector", path: "embedding",\n      queryVector, numCandidates: 100, limit: 10 } }\n])`,
    "rrf": `for (let i = 0; i < hits.length; i++) {\n  rrf[hits[i].id] = (rrf[hits[i].id] || 0) + 1 / (60 + i + 1);\n}`,
  };
  return examples[topic.slug] || examples["mongodb"];
}

export function buildArticle(index, seed = 42) {
  const rng = mulberry32(seed + index);

  const primary = pick(rng, TOPICS);
  let secondary = pick(rng, TOPICS);
  while (secondary.slug === primary.slug) secondary = pick(rng, TOPICS);

  const format = pick(rng, FORMATS);
  const angle = pick(rng, ANGLES);
  const audience = pick(rng, AUDIENCES);

  const title = `${capitalize(angle)} ${primary.name} with ${secondary.name} — a ${format}`;
  const summary = `A ${format} for ${audience} ${primary.name}, focused on ${angle} ${secondary.name.toLowerCase()} in production.`;

  const sectionCount = 3 + Math.floor(rng() * 3); // 3–5 sections
  const sections = pickN(rng, SECTIONS, sectionCount);

  const body = sections
    .map((s) => `## ${s}\n\n${makeParagraph(rng, primary, secondary)}\n\n${makeParagraph(rng, primary, secondary)}`)
    .join("\n\n");

  const code = makeCodeBlock(rng, primary);
  const content = `${body}\n\n\`\`\`js\n${code}\n\`\`\`\n\n${makeParagraph(rng, primary, secondary)}`;

  const tags = [...new Set([...primary.tags, ...secondary.tags, format])];

  return {
    title,
    summary,
    content,
    tags,
    category: format,
  };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
