import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';

export default defineConfig({
  site: 'https://michaeljohnpena.com',
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
