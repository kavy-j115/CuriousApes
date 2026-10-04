import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { verifyState } from "@/lib/shopifyOAuth";
import { completeLogin, fetchAdAccounts, getMetaAppSecret, metaLoginEnv, saveConnection } from "@/lib/metaLogin";

// Facebook redirects here after an agency person approves "Connect Meta". Unlike
// the Shopify callback this one needs a signed-in ADMIN session: the person who
// connects is one of our own staff, so there is no reason to leave it open. Our
// signed `state` is checked as well. The token is never logged or returned.

function back(request: NextRequest, result: string) {
  const { siteUrl } = metaLoginEnv();
  return NextResponse.redirect(`${siteUrl}/dashboard/admin/meta?result=${encodeURIComponent(result)}`, { status: 303 });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const profile = await getCurrentProfile(await createClient());
  if (!profile || profile.role !== "admin") {
    return new NextResponse("Sign in as an admin first, then try Connect Meta again.", { status: 403 });
  }

  if (params.get("error")) return back(request, "cancelled");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back(request, "invalid");

  try {
    const verified = verifyState(state, await getMetaAppSecret());
    if (!verified || verified.clientId !== "meta-connect") return back(request, "expired");

    const login = await completeLogin(code);
    const accounts = await fetchAdAccounts(login.token);
    await saveConnection(login, accounts);
    return back(request, `connected:${accounts.length}`);
  } catch {
    return back(request, "failed");
  }
}
