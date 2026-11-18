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
| Homepage text and focus cards | `src/pages/index.astro` |
| About page | `src/pages/about.astro` |
| Projects list | `src/pages/projects.astro` |
| Contact links | `src/pages/contact.astro` |
| Colors and themes | `src/styles/global.css` |
| Theme switcher dots | `src/components/ThemeSwitcher.astro` |
| Nav links, footer, page layout | `src/layouts/Base.astro` |
| Blog posts | `src/content/writeups/*.md` |

## Writing a post

1. Copy `src/content/writeups/template-writeup.md` to a new file, e.g. `htb-machine-name.md` (the file name becomes the URL).
2. Edit the front matter at the top and write the post in Markdown.
3. Remove `draft: true` when it is ready to publish.
4. Commit and push. The site rebuilds automatically.

## Adding a theme

1. In `src/styles/global.css`, copy a `[data-theme='...']` block, rename it, and change the colors.
2. In `src/components/ThemeSwitcher.astro`, add an entry to the `themes` list.
3. In `src/layouts/Base.astro`, add the id to the `allowed` list in the inline script.

## Deploying

Pushing to the `main` branch runs `.github/workflows/deploy.yml`, which builds the site and publishes it.
In the repository settings, go to Pages and set Source to "GitHub Actions" (one time only).
