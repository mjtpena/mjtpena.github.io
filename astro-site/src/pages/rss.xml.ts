import rss from '@astrojs/rss';
import { getPublishedPosts, postDescription } from '../utils/posts';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const sorted = await getPublishedPosts();

  return rss({
    title: "Michael John Peña — Blog",
    description: "Thoughts on Microsoft Fabric, Azure, AI/ML, data engineering, and the occasional personal reflection.",
    site: context.site!,
    items: sorted.slice(0, 50).map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: postDescription(post),
      categories: post.data.tags,
      link: `/blog/${post.slug}/`,
    })),
    customData: `<language>en-au</language>`,
  });
}
