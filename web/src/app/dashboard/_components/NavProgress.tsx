"use client";

import { createContext, useContext, useTransition } from "react";
import { useRouter } from "next/navigation";

// Wraps router.push in a transition so the shell knows a page is loading: a thin bar
// slides across the top and the content dims until the new data arrives. (Links get the
// same feedback from app/dashboard/loading.tsx; this covers the client / date controls,
// which only change the URL's query string.)
const NavContext = createContext<{ navigate: (url: string) => void; pending: boolean }>({
  navigate: () => {},
  pending: false,
});

export function NavProgressProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = (url: string) => startTransition(() => router.push(url));
  return <NavContext.Provider value={{ navigate, pending }}>{children}</NavContext.Provider>;
}

export function useNav() {
  return useContext(NavContext);
}

export function NavBar() {
  const { pending } = useNav();
  if (!pending) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[130] h-0.5 overflow-hidden bg-accent/20" role="progressbar" aria-label="Loading">
      <div className="h-full w-1/3 animate-[navbar_1s_ease-in-out_infinite] bg-accent" />
    </div>
  );
}

export function NavMain({ children }: { children: React.ReactNode }) {
  const { pending } = useNav();
  return (
    <main className={`flex-1 overflow-x-auto scrollbar-thin bg-zinc-950 p-4 transition-opacity sm:p-6 ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
      {children}
    </main>
  );
}
