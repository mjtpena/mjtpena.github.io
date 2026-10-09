import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

export const AUTHOR_ROLE = 'Data & AI Director';
export const AUTHOR_BIO =
  'Data & AI Director and Microsoft MVP based in Sydney. Writing about Microsoft Fabric, Azure, data engineering, and AI.';

/** Published posts, newest first. */
export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

function plainText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, ' $1 ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^#{1,6} .*$/gm, ' ')
    .replace(/[#>*_~|\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function readingTime(body = ''): number {
  const text = plainText(body);
  const words = text ? text.split(' ').length : 0;
  return Math.max(1, Math.ceil(words / 220));
}

/** Frontmatter description, falling back to the opening prose of the post. */
export function postDescription(post: Post): string {
  if (post.data.description) return post.data.description;
  const text = plainText(post.body || '');
  if (text.length < 40) return post.data.title;
  return text.length > 160 ? `${text.slice(0, 157).replace(/\s+\S*$/, '')}…` : text;
}

export function tagSlug(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/^\./, 'dot')
    .replace(/#/g, '-sharp')
    .replace(/\+/g, '-plus')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function tagHref(tag: string): string {
  return `/blog/tag/${tagSlug(tag)}/`;
}

export interface TagInfo {
  name: string;
  slug: string;
  posts: Post[];
}

/** All tags keyed by slug, most-used first. Spellings that share a slug are merged under the most common one. */
export function buildTagIndex(posts: Post[]): TagInfo[] {
  const bySlug = new Map<string, { posts: Set<Post>; names: Map<string, number> }>();
  for (const post of posts) {
    for (const name of post.data.tags) {
      const slug = tagSlug(name);
      if (!slug) continue;
      const entry = bySlug.get(slug) ?? { posts: new Set<Post>(), names: new Map<string, number>() };
      entry.posts.add(post);
      entry.names.set(name, (entry.names.get(name) ?? 0) + 1);
      bySlug.set(slug, entry);
    }
  }
  return [...bySlug.entries()]
    .map(([slug, { posts, names }]) => ({
      slug,
      name: [...names.entries()].sort((a, b) => b[1] - a[1])[0][0],
      posts: [...posts],
    }))
    .sort((a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name));
}

/** Page numbers to show around the current page, with `null` for gaps. */
export function pageWindow(current: number, last: number, radius = 1): (number | null)[] {
  const pages = new Set([1, last]);
  for (let p = current - radius; p <= current + radius; p++) {
    if (p >= 1 && p <= last) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(null);
    out.push(p);
  });
  return out;
}
