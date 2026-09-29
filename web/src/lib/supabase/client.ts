"use client";

import { createBrowserClient } from "@supabase/ssr";

// For Client Components -- reads/writes the session cookie directly via
// document.cookie, kept in sync with the server client's cookies by the
// middleware.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
