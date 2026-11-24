import { defineConfig } from 'astro/config';

// User site: https://mof4thi.github.io (repo must be named mof4thi.github.io)
// so there is no "base" path to configure.
export default defineConfig({
  site: 'https://mof4thi.github.io',
  // Articles used to live under /writeups/. Keep old links working.
  redirects: {
    '/writeups': '/articles',
    '/writeups/[...slug]': '/articles/[...slug]',
  },
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: false,
    },
  },
});
