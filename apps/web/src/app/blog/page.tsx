import type { Metadata } from 'next';
import Link from 'next/link';
import { BLOG, listPosts } from '../../blog/posts';

export const metadata: Metadata = {
  title: BLOG.title,
  description: 'How the scenes, worlds, characters, courses and questions in Volleyland are built with MCP.',
};

export default function BlogIndexPage() {
  const posts = listPosts();
  return (
    <main className="blog">
      <header className="blog-header">
        <p className="blog-kicker">
          <Link href="/">Volleyland</Link>
        </p>
        <h1>{BLOG.title}</h1>
        <p className="blog-byline">by {BLOG.author}</p>
      </header>
      {posts.length === 0 && <p>The first post is on its way.</p>}
      <ol className="blog-list">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link href={`/blog/${post.slug}`}>
              <span className="blog-list-title">
                {post.title}
                {post.draft && <span className="blog-draft">draft</span>}
              </span>
              {post.summary && <span className="blog-list-summary">{post.summary}</span>}
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
