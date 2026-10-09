import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';

// Posts migrated from the old site keep their original permalink in a `url:` frontmatter
// field. Redirect those old URLs to the current /blog/<file-name>/ location.
function legacyRedirects() {
  const dir = new URL('./src/content/blog/', import.meta.url);
  const redirects = {};
  for (const file of readdirSync(dir)) {
    if (!/\.mdx?$/.test(file)) continue;
    const frontmatter = readFileSync(new URL(file, dir), 'utf8').split('---')[1] ?? '';
    const legacy = frontmatter.match(/^url:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1];
    if (!legacy) continue;
    const from = legacy.replace(/\/+$/, '');
    const to = `/blog/${file.replace(/\.mdx?$/, '')}/`;
    if (from && from !== to.replace(/\/$/, '')) redirects[from] = to;
  }
  return redirects;
}

export default defineConfig({
  site: 'https://michaeljohnpena.com',
  redirects: legacyRedirects(),
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover'
  },
  integrations: [
    tailwind(),
    mdx(),
    sitemap(),
    icon()
  ],
  markdown: {
    syntaxHighlight: 'prism',
  },
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp'
    }
  }
});
