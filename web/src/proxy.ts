import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 renamed the middleware.ts file convention to proxy.ts (the
// `middleware` export name became `proxy`) -- confirmed directly against
// this project's installed Next.js docs before writing this, since
// assuming the older convention would have silently done nothing (Next.js
// wouldn't even recognize a middleware.ts file in this version).
//
// This refreshes the Supabase session on every request. It's required,
// not optional: Server Components can't write cookies themselves (see
// src/lib/supabase/server.ts), so if a token refresh happens there, it has
// nowhere to be written -- only this proxy can actually persist it.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    }
  );

  // getClaims() is the current recommended check (over getSession()/
  // getUser()) -- also required to be called early so a token refresh
  // completes and gets written back via setAll before the response returns.
  const { data } = await supabase.auth.getClaims();

  const isLoginPage = request.nextUrl.pathname.startsWith("/login");
  // Shopify's install redirect (/install = the app's App URL, /callback = the
  // authorization result) lands here from a client's store owner, who
  // has no account in this app. The route verifies Shopify's HMAC and our
  // signed state itself instead of relying on a session.
  const isShopifyCallback =
    request.nextUrl.pathname === "/api/shopify/callback" || request.nextUrl.pathname === "/api/shopify/install";
  // Meta's WhatsApp webhook: no session, the route checks Meta's HMAC signature.
  const isWhatsappWebhook = request.nextUrl.pathname === "/api/whatsapp/webhook";

  if (!data?.claims && !isLoginPage && !isShopifyCallback && !isWhatsappWebhook) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
