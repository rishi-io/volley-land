import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="home">
      <h1>Volleyland</h1>
      <p>Answer to survive.</p>
      <p>
        <Link className="button" href="/play">
          Enter the prototype arena
        </Link>
      </p>
      <p>
        <Link href="/blog">Read how it is built</Link>
      </p>
    </main>
  );
}
