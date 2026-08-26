#!/usr/bin/env node
// Reviews docs pages whose mapped app source files changed in a prod push,
// and applies minimal edits via the Claude API. Edit-only by design: the
// model receives the current human-approved page plus the source diff and
// must return either the full updated page or NO_CHANGE. It never writes
// pages from scratch.
//
// Env: APP (founder|venture), APP_DIR (checkout of the app repo),
//      BEFORE_SHA, AFTER_SHA, ANTHROPIC_API_KEY, MODEL (optional)
// Output: updated .mdx files in place; prints one "UPDATED <page>" line per
//         changed page and "AFFECTED <page>" for every reviewed page.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APP = process.env.APP;
const APP_DIR = process.env.APP_DIR;
const BEFORE = process.env.BEFORE_SHA;
const AFTER = process.env.AFTER_SHA;
const MODEL = process.env.MODEL || "claude-opus-5";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MAX_SOURCE_BYTES = 300_000; // per-page context budget for source files

if (!APP || !APP_DIR || !BEFORE || !AFTER || !API_KEY) {
  console.error("Missing required env (APP, APP_DIR, BEFORE_SHA, AFTER_SHA, ANTHROPIC_API_KEY)");
  process.exit(2);
}

const map = JSON.parse(readFileSync("docs-map.json", "utf8"))[APP];
if (!map || !Object.keys(map.pages).length) {
  console.log(`No mapping for app "${APP}" - nothing to do`);
  process.exit(0);
}

const changed = execFileSync("git", ["-C", APP_DIR, "diff", "--name-only", BEFORE, AFTER], { encoding: "utf8" })
  .split("\n").filter(Boolean);

const matches = (file, pattern) =>
  pattern.endsWith("/") ? file.startsWith(pattern) : file === pattern;

const affected = Object.entries(map.pages).filter(([, patterns]) =>
  changed.some((f) => patterns.some((p) => matches(f, p)))
);

if (!affected.length) {
  console.log("No mapped docs pages affected by this change");
  process.exit(0);
}

const styleRules = readFileSync("AGENTS.md", "utf8");

function listFiles(pattern) {
  const abs = join(APP_DIR, pattern);
  if (!pattern.endsWith("/")) {
    try { statSync(abs); return [pattern]; } catch { return []; }
  }
  try {
    return readdirSync(abs, { recursive: true })
      .map(String)
      .filter((f) => /\.(tsx?|ts|json)$/.test(f))
      .map((f) => join(pattern, f));
  } catch { return []; }
}

async function callClaude(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.map((b) => b.text ?? "").join("");
}

const SYSTEM = `You maintain Caplia's public product documentation (Mintlify MDX). You receive one current documentation page, the app source files it documents, and the diff of a recent production change to those files.

Your job: decide whether the production change makes the page inaccurate or incomplete, and if so apply the MINIMAL edit that fixes it. Preserve the page's existing structure, tone and length. Do not rewrite unaffected sections. Do not add marketing copy.

Hard rules:
- Every UI element name you write in bold must exist verbatim as a string in the provided source files. Never invent or guess a label.
- Never use em-dashes anywhere. Use commas, colons, or separate sentences.
- British English. Sentence case headings. Second person.
- Follow the style guide provided.

Respond with EXACTLY one of:
1. The literal text NO_CHANGE (if the page is still accurate), or
2. The complete updated MDX file content, starting with the --- frontmatter line. No commentary, no code fences around the file.`;

let anyUpdates = false;

for (const [page, patterns] of affected) {
  console.log(`AFFECTED ${page}`);
  const mdxPath = `${page}.mdx`;
  const current = readFileSync(mdxPath, "utf8");

  let sourceBudget = MAX_SOURCE_BYTES;
  const sources = [];
  for (const pattern of patterns) {
    for (const file of listFiles(pattern)) {
      try {
        const content = readFileSync(join(APP_DIR, file), "utf8");
        if (content.length > sourceBudget) continue;
        sourceBudget -= content.length;
        sources.push(`--- ${file} ---\n${content}`);
      } catch { /* deleted file */ }
    }
  }

  const relevantChanged = changed.filter((f) => patterns.some((p) => matches(f, p)));
  const diff = execFileSync(
    "git", ["-C", APP_DIR, "diff", BEFORE, AFTER, "--", ...relevantChanged],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  ).slice(0, 60_000);

  const user = `APP: ${map.appName}

STYLE GUIDE:
${styleRules}

CURRENT DOCUMENTATION PAGE (${mdxPath}):
${current}

PRODUCTION CHANGE (diff of the mapped source files):
${diff}

CURRENT SOURCE FILES (ground truth for every UI name):
${sources.join("\n\n")}`;

  const result = (await callClaude(SYSTEM, user)).trim();

  if (result === "NO_CHANGE" || result.startsWith("NO_CHANGE")) continue;
  if (!result.startsWith("---")) {
    console.error(`Unexpected model output for ${page} (does not start with frontmatter) - skipping`);
    continue;
  }
  writeFileSync(mdxPath, result.endsWith("\n") ? result : result + "\n");
  console.log(`UPDATED ${page}`);
  anyUpdates = true;
}

if (!anyUpdates) console.log("All affected pages still accurate - no edits");
