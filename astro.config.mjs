import { defineConfig } from 'astro/config';

// User site: https://mof4thi.github.io (repo must be named mof4thi.github.io)
// so there is no "base" path to configure.
export default defineConfig({
  site: 'https://mof4thi.github.io',
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
    },
  },
});
