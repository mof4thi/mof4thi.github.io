# mof4thi.github.io

Personal cybersecurity blog and portfolio, built with [Astro](https://astro.build) and hosted on GitHub Pages.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

## Where things live

| What you want to change | File |
| --- | --- |
| Homepage text (and the terminal panel in `src/components/Terminal.astro`) | `src/pages/index.astro` |
| About page | `src/pages/about.astro` |
| Projects (one Markdown file each) | `src/content/projects/*.md` |
| Contact links | `src/pages/contact.astro` |
| Colors | `src/styles/global.css` |
| Nav links, footer, page layout | `src/layouts/Base.astro` |
| Articles | `src/content/articles/*.md` |

## French version

Everything has a French twin under `/fr/`. UI text is in `src/i18n/ui.ts`, and French articles and projects go in a `fr/` subfolder next to the English file, with the same file name.

## Writing an article

1. Copy `src/content/articles/template-article.md` to a new file, e.g. `htb-machine-name.md` (the file name becomes the URL).
2. Edit the front matter at the top and write the post in Markdown.
3. Remove `draft: true` when it is ready to publish.
4. Commit and push. The site rebuilds automatically.

## Adding a project

Add a Markdown file to `src/content/projects/`. The front matter (`title`, `summary`, `context`, `stack`, `order`, optional `featured` and `links`) fills the collapsed block, and the Markdown body is shown when it is opened.

## Deploying

Pushing to the `main` branch runs `.github/workflows/deploy.yml`, which builds the site and publishes it.
In the repository settings, go to Pages and set Source to "GitHub Actions" (one time only).
