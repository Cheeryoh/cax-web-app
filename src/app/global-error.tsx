"use client";

// Prevent static prerendering of this error boundary.
// Next.js 16.2.1 has a bug where /_global-error/page ignores appConfig when
// determining static-vs-dynamic generation, causing the production build to
// crash with "TypeError: Cannot read properties of null (reading 'useContext')".
// force-dynamic opts this component out of static generation. Works in
// combination with the patch to node_modules/next/dist/build/utils.js that
// removes the hardcoded empty appConfig for the _global-error route.
export const dynamic = "force-dynamic";

export default function GlobalError({
  error: _error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html>
      <body>
        <h2>Something went wrong!</h2>
        <button onClick={() => unstable_retry()}>Try again</button>
      </body>
    </html>
  );
}
