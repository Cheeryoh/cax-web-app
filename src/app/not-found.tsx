import Link from "next/link";

// Prevent static prerendering of this page.
// The layout includes AuthProvider (a client component with hooks) which fails
// during static prerender on Next.js 16.2.1.
export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <main className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">This page could not be found.</p>
      <Link href="/" className="text-primary underline underline-offset-4">
        Go home
      </Link>
    </main>
  );
}
