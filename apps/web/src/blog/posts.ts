import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';

/** The blog's name and author line; Rishi's to change. */
export const BLOG = {
  title: 'Building Volleyland',
  author: 'Rishi, 15',
};

/** Posts are Markdown files in apps/web/content/blog, read at build time. */
const POSTS_DIR = path.join(process.cwd(), 'content/blog');

export interface Post {
  slug: string;
  title: string;
  summary: string;
  /** Position in the series: posts are listed in this order, not by date. */
  order: number;
  date: string | null;
  draft: boolean;
  body: string;
}

/** Drafts show in `yarn dev` (marked as drafts) and never in a production build. */
export const showDrafts = process.env.NODE_ENV !== 'production';

/** Reads `key: value` lines between `---` fences; a post needs nothing richer. */
function parseFrontmatter(source: string): { data: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match?.[1]) return { data: {}, body: source };
  const data: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) data[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { data, body: source.slice(match[0].length) };
}

function readPost(file: string): Post {
  const { data, body } = parseFrontmatter(readFileSync(path.join(POSTS_DIR, file), 'utf8'));
  const slug = file.replace(/\.md$/, '').replace(/^\d+-/, '');
  return {
    slug,
    title: data.title ?? slug,
    summary: data.summary ?? '',
    order: Number(data.order ?? 999),
    date: data.date || null,
    draft: data.draft === 'true',
    body,
  };
}

export function listPosts(): Post[] {
  return readdirSync(POSTS_DIR)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .map(readPost)
    .filter((post) => showDrafts || !post.draft)
    .sort((a, b) => a.order - b.order);
}

export function getPost(slug: string): Post | undefined {
  return listPosts().find((post) => post.slug === slug);
}

export function renderPost(post: Post): string {
  return marked.parse(post.body, { async: false });
}
