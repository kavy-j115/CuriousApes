import Link from "next/link";

// Pages anyone can open without logging in: the privacy policy, terms and support page that the
// Shopify app listing links to (proxy.ts lets these paths through).
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-zinc-300">
      <header className="border-b border-zinc-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold tracking-wide text-zinc-100">CURIOUS APES</span>
          <nav className="flex gap-4 text-xs text-zinc-400">
            <Link href="/privacy" className="hover:text-zinc-100">Privacy</Link>
            <Link href="/terms" className="hover:text-zinc-100">Terms</Link>
            <Link href="/support" className="hover:text-zinc-100">Support</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10 text-sm leading-relaxed [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-50 [&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-3 [&_ul]:mb-3">
        {children}
      </main>
    </div>
  );
}
