import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// One new client per request, per @supabase/ssr's own guidance -- never
// share a server client across requests. Used in Server Components and
// Route Handlers, which in Next.js *cannot* write cookies themselves --
// setAll here is wrapped in try/catch for exactly that reason. The actual
// token-refresh cookie write happens in middleware.ts instead, which can
// write cookies; this client just needs to not crash when it can't.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component, which can't set cookies.
            // Harmless as long as middleware.ts is refreshing the session.
          }
        },
      },
    }
  );
}
