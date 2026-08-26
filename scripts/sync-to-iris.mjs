#!/usr/bin/env node
// Syncs founder-portal docs pages into the shared product_support_articles
// table that the founder app's Iris assistant reads (instant-mode cache and
// fallback when the Mintlify MCP search is unavailable).
//
// Deterministic: no AI involved. Strips MDX to plain markdown, derives
// keywords from frontmatter, headings and bold UI labels, and upserts one row
// per page, keeping the historical category ids stable.
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sync-to-iris.mjs
// Optional: DRY_RUN=1 prints the payload instead of writing.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = !!process.env.DRY_RUN;
const DOCS_BASE = "https://docs.venture.caplia.ai";

if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. If running in CI, the org secrets may not be visible to this repo."
  );
  process.exit(2);
}

// Page slug -> stable article id (matches the ids Iris has always used; the
// route planner and pre-router reference these categories).
const PAGE_IDS = {
  "getting-started": "getting_started",
  "readiness-index": "score",
  "data-room": "data_room",
  pipeline: "pipeline",
  passport: "passport",
  "cap-table": "cap_table",
  psychometrics: "psychometrics",
  billing: "billing",
  team: "team",
  "sharing-access": "sharing",
  "account-settings": "account",
  iris: "iris",
  troubleshooting: "troubleshooting",
  "link-your-passport": "link_your_passport",
};

const STOPWORDS = new Set(
  "the a an and or but for nor with from into onto your you our their this that these those what when where which how why who whom can will shall may might must been being are is was were be do does did has have had not no yes it its if then than as at by of on in to up out over under more most less least very just also only own same so too s t".split(" ")
);

// Iris's retrieval gate ORs every query word against these arrays, so a bare
// generic word as a keyword makes ordinary fundraising-advice questions match
// product articles. Singles on this list are dropped (multi-word phrases that
// contain them are kept: "cap table", "readiness index", "pitch deck").
const GENERIC_SINGLES = new Set(
  ("more other another email emails find found name names back big small first next last each every open close view click see set get use new full page pages help support click button menu tab section list card row item items " +
    "market growth company companies founder founders investor investors fundraising fundraise funding round rounds seed stage deal deals note notes team question questions answer answers status active check checks change changes " +
    "index progress profile document documents file files folder upload download share sharing link links access video date year month time create delete edit update add remove save cancel confirm won closed draft drafts partner partners").split(" ")
);

function words(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function stripMdx(raw) {
  // Frontmatter
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  let title = "", description = "";
  let body = raw;
  if (fm) {
    body = raw.slice(fm[0].length);
    title = (fm[1].match(/^title:\s*["']?(.+?)["']?\s*$/m) || [])[1] || "";
    description = (fm[1].match(/^description:\s*["']?(.+?)["']?\s*$/m) || [])[1] || "";
  }

  let md = body
    // <Step title="X"> -> bolded step heading; </Step> dropped
    .replace(/<Step\s+title=["']([^"']+)["'][^>]*>/g, "\n**$1**\n")
    .replace(/<Accordion\s+title=["']([^"']+)["'][^>]*>/g, "\n### $1\n")
    .replace(/<Card\s+title=["']([^"']+)["'][^>]*>/g, "\n**$1**\n")
    // Callouts become labelled blockquote-style lines
    .replace(/<Note>/g, "\n> Note: ")
    .replace(/<Tip>/g, "\n> Tip: ")
    .replace(/<Warning>/g, "\n> Warning: ")
    // Drop every remaining JSX open/close tag but keep inner text
    .replace(/<\/?[A-Z][A-Za-z]*[^>]*>/g, "")
    // Collapse the whitespace the tag removal leaves behind
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, description, md };
}

function deriveKeywords(slug, title, description, md) {
  const phrases = new Set();
  // Multi-word phrases: title, headings, bold labels, slug
  const addPhrase = (p) => {
    const clean = p.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (!clean || clean.length > 40) return;
    // Single-word "phrases" (one-word UI labels, headings) get the same
    // precision filter as derived singles.
    if (!clean.includes(" ") && (GENERIC_SINGLES.has(clean) || STOPWORDS.has(clean))) return;
    phrases.add(clean);
  };
  addPhrase(slug.replace(/-/g, " "));
  if (title) addPhrase(title);
  for (const m of md.matchAll(/^#{2,3}\s+(.+)$/gm)) addPhrase(m[1]);
  for (const m of md.matchAll(/\*\*([^*\n]{3,40})\*\*/g)) addPhrase(m[1]);
  // Single words from title + description + headings, minus generic ones that
  // would make unrelated queries match (precision over recall for singles;
  // recall comes from the phrases).
  const singles = new Set(
    [
      ...words(title),
      ...words(description),
      ...[...md.matchAll(/^#{2,3}\s+(.+)$/gm)].flatMap((m) => words(m[1])),
    ]
      // Users type singular ("subscription") where headings are plural, so
      // index the naive stem alongside each plural.
      .flatMap((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? [w, w.slice(0, -1)] : [w]))
      .filter((w) => !GENERIC_SINGLES.has(w))
  );
  return [...phrases, ...singles].slice(0, 80);
}

const dir = "founder-portal";
const rows = [];
for (const file of readdirSync(dir)) {
  if (!file.endsWith(".mdx")) continue;
  const slug = file.replace(/\.mdx$/, "");
  const id = PAGE_IDS[slug];
  if (!id) {
    if (slug !== "index") console.error(`WARN: no article id mapped for ${slug}, skipping`);
    continue;
  }
  const raw = readFileSync(join(dir, file), "utf8");
  const { title, description, md } = stripMdx(raw);
  const content = [
    `# ${title}`,
    description,
    `Full guide: ${DOCS_BASE}/founder-portal/${slug}`,
    "",
    md,
  ].join("\n");
  rows.push({
    id,
    title,
    category: id,
    content,
    keywords: deriveKeywords(slug, title, description, md),
    source_files: [`docs:founder-portal/${slug}.mdx`],
    generated_at: new Date().toISOString(),
    model_version: "mintlify-docs-sync",
  });
}

console.log(`Prepared ${rows.length} articles: ${rows.map((r) => r.id).join(", ")}`);

if (DRY_RUN) {
  for (const r of rows) {
    console.log(`\n--- ${r.id} (${r.content.length} chars, ${r.keywords.length} keywords)`);
    console.log(r.keywords.join(" | "));
  }
  process.exit(0);
}

const res = await fetch(`${SUPABASE_URL}/rest/v1/product_support_articles`, {
  method: "POST",
  headers: {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates",
  },
  body: JSON.stringify(rows),
});
if (!res.ok) {
  console.error(`Upsert failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`Upserted ${rows.length} articles to ${new URL(SUPABASE_URL).host}`);
