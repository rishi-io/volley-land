import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BLOG, getPost, listPosts, renderPost } from '../../../blog/posts';

/** Every post is rendered at build time; an unknown slug is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return listPosts().map((post) => ({ slug: post.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getPost((await params).slug);
  return post ? { title: `${post.title} · ${BLOG.title}`, description: post.summary } : {};
}

export default async function BlogPostPage({ params }: Props) {
  const post = getPost((await params).slug);
  if (!post) notFound();
  return (
    <main className="blog">
      <header className="blog-header">
        <p className="blog-kicker">
          <Link href="/blog">{BLOG.title}</Link>
        </p>
        <h1>
          {post.title}
          {post.draft && <span className="blog-draft">draft</span>}
        </h1>
        <p className="blog-byline">
          by {BLOG.author}
          {post.date && ` · ${post.date}`}
        </p>
      </header>
      <article className="blog-post" dangerouslySetInnerHTML={{ __html: renderPost(post) }} />
    </main>
  );
}
