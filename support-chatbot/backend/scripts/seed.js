/**
 * Seeds a small, deliberately-shaped demo dataset.
 *
 * Small on purpose: every document exists to make one behaviour observable.
 * A thousand synthetic articles would prove the pipeline runs; four curated
 * ones prove it does the right thing.
 *
 * What the data is built to demonstrate — see "Things to try" in the README:
 *
 *   1. ENTITLEMENT. "How do I export the audit log?" is answerable only from
 *      an `audience: "enterprise"` article. Ask it as the Free customer and
 *      the passage is not retrieved — not hidden after retrieval, never
 *      scored at all.
 *   2. CONDENSATION. The SAML article has a "Pricing" section, so the
 *      follow-up "and how much is that?" only works if the rewrite carried
 *      "SAML SSO" into the standalone question.
 *   3. TICKET BEATS DOC. Error AUTH_302 is documented in formal language and
 *      also solved in a past ticket written in symptom language ("stuck on
 *      the login screen after SSO redirect"). A customer describing symptoms
 *      matches the ticket; a customer quoting the code matches the doc.
 *   4. TOOLS. Two orders, one shipped with a tracking code, so "where is my
 *      order?" exercises lookupOrder with customerId from the session.
 *
 * Idempotent: drops and recreates the collections it owns.
 *
 * Run: npm run seed
 */
import "dotenv/config";
import { Collections, connectDB, closeDB, getDB } from "../src/db.js";
import { embed } from "../src/voyage.js";
import { chunkArticle } from "../src/utils/chunker.js";
import { tuning } from "../src/config.js";

const CUSTOMERS = [
  {
    email: "dana@northwind.example",
    name: "Dana Okafor",
    plan: "enterprise",
    locale: "en",
    seats: 250,
    subscriptionStatus: "active",
    renewsAt: new Date("2027-03-01"),
  },
  {
    email: "sam@tinystudio.example",
    name: "Sam Ferreira",
    plan: "free",
    locale: "en",
    seats: 1,
    subscriptionStatus: "active",
    renewsAt: null,
  },
];

const ORDERS = [
  {
    orderRef: "ORD-1042",
    status: "shipped",
    carrier: "DHL",
    trackingCode: "JD014600007899123456",
    eta: new Date("2026-08-27"),
    total: 249.0,
    placedAt: new Date("2026-08-14"),
    customerEmail: "dana@northwind.example",
  },
  {
    orderRef: "ORD-1043",
    status: "processing",
    carrier: null,
    trackingCode: null,
    eta: null,
    total: 19.0,
    placedAt: new Date("2026-08-18"),
    customerEmail: "sam@tinystudio.example",
  },
];

const ARTICLES = [
  {
    title: "SAML SSO",
    slug: "saml-sso",
    category: "identity",
    tags: ["sso", "saml", "identity", "security"],
    audience: "all",
    locale: "en",
    status: "published",
    content: `# SAML SSO

Single sign-on lets your team authenticate through your existing identity
provider instead of managing separate passwords.

## Supported providers

Okta, Microsoft Entra ID, Google Workspace, OneLogin and any provider that
speaks SAML 2.0.

## Configuration

Open Settings → Authentication → SAML and copy the ACS URL and Entity ID into
your identity provider. Paste the provider's metadata XML back into the form
and save.

You can verify the connection before enforcing it. The test button signs in a
single user without changing the login flow for anyone else.

\`\`\`bash
# verify the metadata endpoint responds before you enforce SSO
curl -sS https://api.example.com/saml/metadata | head -20
\`\`\`

## Enforcing SSO

Once enforcement is on, password login is disabled for every member of the
workspace. Keep one break-glass administrator with password access until you
have confirmed the integration works.

## Pricing

SAML SSO is included on the Pro and Enterprise plans at no additional cost.
On the Free plan it is not available. There is no per-seat surcharge for SSO
on any plan, and enabling it does not change your billing date.`,
  },
  {
    title: "Exporting the audit log",
    slug: "audit-log-export",
    category: "compliance",
    tags: ["audit", "compliance", "export", "security"],
    // Enterprise-only. This is the document that makes the entitlement
    // pre-filter visible: the same question returns different passages for
    // different plans, because the index never scores this one for a Free
    // customer.
    audience: "enterprise",
    locale: "en",
    status: "published",
    content: `# Exporting the audit log

The audit log records every administrative action in the workspace: member
changes, permission edits, SSO configuration, API key rotation and data
exports.

## Retention

Audit events are retained for 400 days on Enterprise. Events older than the
retention window are removed and cannot be recovered.

## Exporting from the console

Go to Settings → Security → Audit log and choose Export. Select a date range
of up to 90 days per export and pick CSV or JSON. Large exports are prepared
in the background and emailed as a signed download link that expires after 24
hours.

## Exporting via the API

Authenticate with an API key that has the \`audit:read\` scope.

\`\`\`bash
# fetch one day of audit events as JSON
curl -H "Authorization: Bearer $API_KEY" \\
  "https://api.example.com/v1/audit?from=2026-08-01&to=2026-08-02"
\`\`\`

The endpoint paginates at 1000 events per page. Follow the \`next\` cursor
until it comes back null.

## Streaming to a SIEM

Enterprise workspaces can stream audit events continuously to Splunk,
Datadog or any HTTPS endpoint that accepts newline-delimited JSON.`,
  },
  {
    title: "Login errors after SSO redirect",
    slug: "login-errors-sso",
    category: "troubleshooting",
    tags: ["auth", "sso", "troubleshooting", "errors"],
    audience: "all",
    locale: "en",
    status: "published",
    // Documents AUTH_302 in formal, precise language. The ticket below
    // describes the same failure the way a customer experiences it. Which
    // one wins depends on how the customer phrases the question — that is
    // the point of carrying both corpora.
    content: `# Login errors after SSO redirect

## AUTH_302 — assertion audience mismatch

Error code AUTH_302 is returned when the SAML assertion presented by the
identity provider carries an Audience URI that does not match the Entity ID
configured for the workspace.

The most common cause is a trailing slash: an Entity ID of
\`https://app.example.com/\` will not match an audience of
\`https://app.example.com\`. The comparison is exact and case-sensitive.

To resolve, open the identity provider's application settings and set the
Audience URI to exactly the Entity ID shown in Settings → Authentication.

## AUTH_305 — clock skew

Returned when the assertion's NotBefore or NotOnOrAfter timestamps fall
outside the accepted window. Ensure both systems synchronise against NTP; the
tolerance is 120 seconds.

## AUTH_311 — unsigned assertion

The workspace requires signed assertions. Enable assertion signing in the
identity provider, not just response signing.`,
  },
  {
    title: "Shipping and tracking",
    slug: "shipping-tracking",
    category: "orders",
    tags: ["shipping", "orders", "tracking", "delivery"],
    audience: "all",
    locale: "en",
    status: "published",
    content: `# Shipping and tracking

## When an order ships

Orders are picked the next business day. You receive an email with a tracking
code as soon as the carrier scans the parcel.

## Tracking a shipment

Your order status and tracking code are visible in the chat — just ask about
your order and the agent will look it up on your account.

Once the carrier has the parcel, tracking updates appear within a few hours.
A code that shows no movement for 24 hours usually means the parcel is in
transit between depots rather than lost.

## Delivery estimates

Standard delivery is 3-5 business days domestically and 7-12 internationally.
Estimates exclude customs processing, which we cannot influence.

## Missing parcels

If tracking shows delivered and you have not received the parcel, check with
neighbours and building reception first, then contact support with the order
reference so we can open a carrier investigation.`,
  },
];

const TICKETS = [
  {
    subject: "Stuck on login screen after SSO redirect",
    // Symptom language, no error code. A customer who types "I get bounced
    // back to the login page after signing in with Okta" matches this and
    // not the formal AUTH_302 documentation.
    problem: `Customer configured Okta and every user gets bounced back to the login
page right after signing in. No error shown on screen, just the login form
again. Browser console shows a failed POST to /saml/acs.`,
    resolution: `The Okta app had the Audience URI set with a trailing slash while the
workspace Entity ID had none. Removed the trailing slash in Okta, re-tested
with the verify button, sign-in worked immediately. Told the customer the
comparison is exact so any difference in the URI breaks the assertion.`,
    quality: 0.94,
    locale: "en",
    status: "resolved",
    resolvedAt: new Date("2026-07-02"),
  },
  {
    subject: "SSO test button works but enforcement locks everyone out",
    problem: `Customer enabled SSO enforcement and immediately lost access for the whole
team, including admins. The verify button had worked before enforcing.`,
    resolution: `Verify only tests one user's assertion; it does not check that every
member has a matching identity in the provider. Members whose email in the
provider differed from their email in the workspace could not be matched.
Restored access through the break-glass admin, aligned the emails, re-enabled
enforcement. Advised always keeping one password-capable admin.`,
    quality: 0.88,
    locale: "en",
    status: "resolved",
    resolvedAt: new Date("2026-05-19"),
  },
  {
    subject: "Audit export email link expired before download",
    problem: `Customer requested a 90-day audit export, got the email hours later, and
the download link had already expired by the time they clicked it.`,
    resolution: `Signed download links expire 24 hours after the export finishes, not after
the email is sent — the export had been queued behind a larger job. Re-ran
the export in two 45-day windows, which completed in minutes each. Suggested
the API endpoint with cursor pagination for anything recurring.`,
    quality: 0.79,
    locale: "en",
    status: "resolved",
    resolvedAt: new Date("2026-03-11"),
  },
];

async function main() {
  const db = await connectDB();

  console.log("\n→ resetting collections");
  for (const name of [
    Collections.customers,
    Collections.orders,
    Collections.kbArticles,
    Collections.kbChunks,
    Collections.tickets,
    Collections.conversations,
    Collections.messages,
    Collections.escalations,
  ]) {
    await db.collection(name).deleteMany({});
  }

  /* -- Customers + orders ------------------------------------------------- */
  const customerDocs = CUSTOMERS.map((c) => ({ ...c, createdAt: new Date() }));
  const { insertedIds } = await db.collection(Collections.customers).insertMany(customerDocs);
  const idByEmail = new Map(
    customerDocs.map((c, i) => [c.email, insertedIds[i]]),
  );
  console.log(`  ✓ ${customerDocs.length} customers`);

  const orderDocs = ORDERS.map(({ customerEmail, ...o }) => ({
    ...o,
    customerId: idByEmail.get(customerEmail),
  }));
  await db.collection(Collections.orders).insertMany(orderDocs);
  console.log(`  ✓ ${orderDocs.length} orders`);

  /* -- Articles + chunks -------------------------------------------------- */
  const articleDocs = ARTICLES.map((a) => ({ ...a, createdAt: new Date(), updatedAt: new Date() }));
  const { insertedIds: articleIds } = await db
    .collection(Collections.kbArticles)
    .insertMany(articleDocs);
  console.log(`  ✓ ${articleDocs.length} KB articles`);

  console.log("\n→ chunking + embedding");
  const chunkRecords = [];
  articleDocs.forEach((article, i) => {
    const chunks = chunkArticle(article.title, article.content, {
      maxChunkSize: tuning.maxChunkSize,
    });
    for (const chunk of chunks) {
      chunkRecords.push({
        articleId: articleIds[i],
        chunkIndex: chunk.chunkIndex,
        breadcrumb: chunk.breadcrumb,
        text: chunk.text,
        // Denormalised from the parent article so they can be declared as
        // `filter` fields in the vector index. A $lookup cannot participate
        // in a $vectorSearch pre-filter — the filter has to be evaluated by
        // the index, on the chunk document itself.
        audience: article.audience,
        locale: article.locale,
        category: article.category,
        tags: article.tags,
        status: article.status,
      });
    }
  });

  const chunkVectors = await embed(chunkRecords.map((c) => c.text), "document");
  chunkRecords.forEach((c, i) => (c.embedding = chunkVectors[i]));
  await db.collection(Collections.kbChunks).insertMany(chunkRecords);
  console.log(`  ✓ ${chunkRecords.length} chunks embedded`);

  /* -- Tickets ------------------------------------------------------------ */
  // Tickets embed problem + resolution together: the customer's query looks
  // like the problem, but the resolution is what makes the ticket worth
  // retrieving. Embedding only one half loses one of those.
  const ticketDocs = TICKETS.map((t) => ({ ...t }));
  const ticketVectors = await embed(
    ticketDocs.map((t) => `${t.subject}\n${t.problem}\n${t.resolution}`),
    "document",
  );
  ticketDocs.forEach((t, i) => (t.embedding = ticketVectors[i]));
  await db.collection(Collections.tickets).insertMany(ticketDocs);
  console.log(`  ✓ ${ticketDocs.length} resolved tickets embedded`);

  /* -- Print the ids the UI needs ----------------------------------------- */
  console.log("\n✓ seed complete\n");
  console.log("  Customer ids — paste one into the frontend picker:");
  for (const c of customerDocs) {
    console.log(`    ${String(idByEmail.get(c.email))}  ${c.plan.padEnd(10)} ${c.name} <${c.email}>`);
  }
  console.log("\n  Try these:");
  console.log('    "How do I export the audit log?"        as enterprise, then as free');
  console.log('    "How do I set up SAML?" then "and how much is that?"');
  console.log('    "I get bounced back to the login page after signing in with Okta"');
  console.log('    "Where is my order ORD-1042?"           as Dana (enterprise)');
  console.log("");

  await closeDB();
}

main().catch((err) => {
  console.error("\n✗ seed failed:", err);
  process.exit(1);
});
