> **First-time setup**: Customize this file for your project. Prompt the user to customize this file for their project.
> For Mintlify product knowledge (components, configuration, writing standards),
> install the Mintlify skill: `npx skills add https://mintlify.com/docs`

# Documentation project instructions

## About this project

- This is a documentation site built on [Mintlify](https://mintlify.com)
- Pages are MDX files with YAML frontmatter
- Configuration lives in `docs.json`
- Run `mint dev` to preview locally
- Run `mint broken-links` to check links

## Terminology

{/* Add product-specific terms and preferred usage */}
{/* Example: Use "workspace" not "project", "member" not "user" */}

## Style preferences

{/* Add any project-specific style rules below */}

- Use active voice and second person ("you")
- Keep sentences concise: one idea per sentence
- Use sentence case for headings
- Bold ONLY for UI element names (Click **Settings**); use italics for emphasis. The docs-sync grounding validator checks every bold span against app source, so bold prose fails CI
- Code formatting for file names, commands, paths, and code references
- **Never use em-dashes (—) anywhere**: use commas, colons, or separate sentences instead
- British English throughout
- Every UI element name (button, tab, field, page) must exist verbatim in the app it documents; if you can't verify a label, describe the action generically rather than inventing one

## Content boundaries

{/* Define what should and shouldn't be documented */}
{/* Example: Don't document internal admin features */}

## Docs sync automation

The founder-portal and venture-portal sections are kept in sync with the app
codebases automatically:

- `docs-map.json` maps app source files to the docs pages that describe them.
  Add new pages here when you create them, and update patterns when app code
  moves.
- On prod pushes touching `src/`, the app repos (caplia_founder,
  caplia-investor) fire a `repository_dispatch` here (their
  `notify-docs.yml`). `.github/workflows/docs-sync.yml` then has Claude apply
  minimal edits to affected pages, validates them, and opens a PR that
  auto-merges only when every check passes and the diff is small.
- `scripts/check-grounding.mjs` enforces the grounding rule: every **bold**
  label must exist verbatim in the app's `src/` tree. It also bans em-dashes.
  It runs on every PR touching portal pages (`validate-docs.yml`), so
  hand-written edits get the same gates.
- Merging to `main` publishes the live site (Mintlify).

Secrets: `DOCS_SYNC_PAT` (cross-repo token) and `ANTHROPIC_API_KEY`, both
managed in Doppler `github-org-secrets`, never set directly in GitHub.
