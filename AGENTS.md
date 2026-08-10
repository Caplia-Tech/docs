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
- Keep sentences concise — one idea per sentence
- Use sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references

## Content boundaries

{/* Define what should and shouldn't be documented */}
{/* Example: Don't document internal admin features */}

## Cursor Cloud specific instructions

- Mintlify site. The `mint` CLI is a global npm tool, not a repo dependency, so it is intentionally **not** part of the Cloud update script. The default global npm prefix on the VM is not writable, so install `mint` to a user prefix:

  ```
  npm config set prefix "$HOME/.npm-global"
  npm install -g mint
  npm config delete prefix   # optional: removes an nvm "prefix" warning; the binary stays at ~/.npm-global/bin/mint
  ```

- Preview with `mint dev` (serves on http://localhost:3000); check links with `mint broken-links`.
