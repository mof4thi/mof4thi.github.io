# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Personal cybersecurity blog/portfolio for https://mof4thi.github.io, built with Astro (static output) and deployed to GitHub Pages. It is a user site, so `astro.config.mjs` sets `site` with no `base` path. Root-relative links like `/writeups/` are correct as written.

## Commands

```bash
npm install
npm run dev        # http://localhost:4321 (draft posts are visible here)
npm run build      # static build into dist/; also type-checks content front matter against the schema
npm run preview    # serve dist/ locally
```

There is no linter or test suite. `npm run build` is the verification step: invalid post front matter fails the build.

Deployment: pushing to `main` runs `.github/workflows/deploy.yml` (`withastro/action`, Node 22), which builds and publishes to Pages. A push to `main` is a production deploy.

## Architecture

- **Content collections** (`src/content.config.ts`):
  - `articles` globs `src/content/articles/**/*.{md,mdx}` and uses a zod schema (`title`, `date`, `summary`, optional `category` (default `notes`), `tags`, and `draft`). A file name (`post.id`) becomes its URL: `/articles/<id>/`.
  - `projects` globs `src/content/projects/*.md`. The front matter (`title`, `summary`, `context`, `stack`, `order`, `featured`, `links`) fills a collapsed block on `/projects/`, and the Markdown body is the expanded content. Each block is a `<details name="project">` with the file name as its `id`, so `/projects/#<id>` opens it directly. Featured blocks span the full grid width.
- **Old URLs**: articles used to live under `/writeups/`. `redirects` in `astro.config.mjs` keeps those links working, so don't remove it.
- **Draft handling is repeated in three places** and must stay consistent:
  - `src/pages/articles/index.astro` and `src/pages/articles/[...slug].astro` include drafts only when `import.meta.env.DEV` is true.
  - `src/pages/rss.xml.js` always excludes drafts.
- **Article page** (`src/pages/articles/[...slug].astro`): it builds a table of contents from the h2/h3 headings when there are at least 3 h2s. That's a sticky sidebar at 1100px and wider, and a collapsible box above the article on narrower screens. A client script adds copy buttons to code blocks and highlights the current section. Reading time comes from `src/lib/reading-time.ts`.
- **Images** go in `public/images/` (one subfolder per article for bigger sets, e.g. `public/images/elk/`) and are referenced as `/images/...` from Markdown.
- **Layout**: `src/layouts/Base.astro` is the single shell (head/meta/OG tags, nav, footer). Every page wraps its content in `<Base title description>`. Code highlighting uses Shiki's `github-dark` theme (configured in `astro.config.mjs`).
- **Colors**: the site is dark only. There is no light theme and no theme switcher, by the owner's choice. All colors are CSS variables in the `:root` block at the top of `src/styles/global.css`.

## Languages (English and French)

The whole site exists in English (at the root) and French (under `/fr/`). Every page and article needs both versions.

- **Pages**: page markup lives in `src/views/*.astro`, which take a `lang` prop. The files in `src/pages/` and `src/pages/fr/` are thin wrappers that render a view with `lang="en"` or `lang="fr"`. Change a view, not the wrappers.
- **UI strings** (nav, buttons, labels, terminal lines) are in `src/i18n/ui.ts`. Add every new key to both `en` and `fr`. Use `localize(lang, path)` for internal links. `Base.astro` reads the language from the URL, so it needs no prop.
- **Content**: French articles and projects sit in a `fr/` subfolder next to the English ones, with the **same file name** (`src/content/articles/fr/`, `src/content/projects/fr/`). The shared file name is what pairs them and drives the EN/FR switch. Links inside French content must point to `/fr/...`.
- **About page** copy is inline in `src/views/About.astro`, as an `en`/`fr` object.
- **French typography**: put a non-breaking space (U+00A0) before `:` `;` `!` `?` `»` and after `«`, but never inside code.
- **Language switch**: the header `EN / FR` link goes to the same path in the other language. On a first visit to `/` from a French-language browser, an inline script in `Base.astro` redirects to `/fr/`, then remembers the choice in `localStorage`.

## Design direction

The owner wants the site to not look AI-generated. Avoid blue/navy palettes, orange/terracotta accents (they read as Claude's brand), dotted or grid backgrounds, glassy blurred sticky headers, pill badges, hover-lift cards, glyph arrows (→ ←) and em or en dashes in copy. The current look: neutral charcoal background, a crimson accent, serif body text, monospace for metadata, and lists separated by thin rules instead of cards. Listing pages and the homepage use the wide `.wrap` (1080px); reading pages (posts, about, contact) use `.wrap.narrow` to keep line length readable.

The homepage hero has three animations, all skipped under `prefers-reduced-motion`: the `MF` logo drawing itself (`Logo.astro` with `animate`), the name decoding from random glyphs (script in `index.astro`), and the terminal replay (`Terminal.astro`). Each one renders as finished static HTML without JavaScript. In `.astro` markup, keep inline text beside a tag like `<strong>` on one line, because Astro's HTML compression drops the space at a line break there.

## Repo notes

- Posts are called "articles" everywhere: in the copy, the URLs and the collection.
- The station blanche project was built for a defense-sector client. Never add the client's name, repository links, hostnames or internal paths.

- `src/content/articles/template-article.md` is the starting point for new articles. It has `draft: true`, so it only shows up in `npm run dev`.
- **Link-preview images** (`public/og-image.png`, `public/og-image-fr.png`, 1200×627, used by LinkedIn and other sites) are rendered from `scripts/og/en.svg` and `fr.svg` with `node scripts/og/render.mjs`. They repeat the homepage terminal's status lines, so when a status changes (e.g. CPTS passed), update `src/components/Terminal.astro` and both SVGs, then re-render.
