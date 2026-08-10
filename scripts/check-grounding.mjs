#!/usr/bin/env node
// Validates changed docs pages against the app source they document.
// 1. Grounding: every **bold** UI label must exist verbatim somewhere in the
//    app repo's src/ tree (string literals, JSX text). This is the check that
//    catches invented button names.
// 2. Style: no em-dashes anywhere in the page.
//
// Usage: node scripts/check-grounding.mjs <appDir> <page.mdx> [...more pages]
// Exits non-zero listing every violation.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [appDir, ...pages] = process.argv.slice(2);
if (!appDir || !pages.length) {
  console.error("Usage: check-grounding.mjs <appDir> <page.mdx> [...]");
  process.exit(2);
}

// Product and navigation names that are legitimate without a source literal
const ALLOWLIST = new Set([
  "Caplia", "Iris", "CRI", "Caplia Passport", "Caplia Readiness Index",
  "Founder Portal", "Venture Portal", "Deal Pipeline", "Data Room",
  "Cap Table", "Founder Tools", "Dashboard", "Messages",
]);

// Concatenate the app's src tree once
let haystack = "";
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(p);
    } else if (/\.(tsx?|ts|json)$/.test(entry.name)) {
      try { haystack += readFileSync(p, "utf8") + "\n"; } catch { /* skip */ }
    }
  }
}
walk(join(appDir, "src"));

let failures = 0;

for (const page of pages) {
  const raw = readFileSync(page, "utf8");
  // Strip frontmatter and code fences before extracting labels
  const body = raw.replace(/^---[\s\S]*?---/, "").replace(/```[\s\S]*?```/g, "");

  if (raw.includes("—")) {
    console.error(`FAIL ${page}: contains an em-dash`);
    failures++;
  }

  for (const match of body.matchAll(/\*\*([^*\n]+)\*\*/g)) {
    const label = match[1].trim();
    // Skip pure prose emphasis: multi-sentence or very long bold spans
    if (label.length > 40 || /[.!?]$/.test(label)) continue;
    if (ALLOWLIST.has(label)) continue;
    if (!haystack.includes(label)) {
      console.error(`FAIL ${page}: bold label "${label}" not found in app source`);
      failures++;
    }
  }
}

if (failures) {
  console.error(`\n${failures} grounding/style violation(s)`);
  process.exit(1);
}
console.log("Grounding and style checks passed");
