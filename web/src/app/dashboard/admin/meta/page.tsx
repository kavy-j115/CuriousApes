import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole } from "@/lib/auth/profile";
import MetaAccounts from "./MetaAccounts";

export default async function AdminMetaPage({ searchParams }: { searchParams: Promise<{ result?: string; client?: string }> }) {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return null;
  assertRole(profile, ["admin"]);

  const { result, client: focusId } = await searchParams;
  const [{ data: connections }, { data: accounts }, { data: clients }] = await Promise.all([
    supabase.from("meta_connections").select("id, fb_user_name, expires_at, connected_at").order("connected_at"),
    supabase.from("meta_ad_accounts").select("account_id, name, business_name, account_status, connection_id").order("name"),
    supabase.from("clients").select("client_id, display_name, meta_ad_account_id").order("display_name"),
  ]);

  return (
    <div data-tour="meta-accounts">
      <h1 className="mb-4 text-xl font-semibold text-zinc-50">Meta Accounts</h1>
      <MetaAccounts
        result={result ?? null}
        focusClientId={focusId ?? null}
        connections={(connections ?? []).map((c) => ({
          id: c.id as string,
          name: (c.fb_user_name as string | null) ?? "Facebook profile",
          expiresAt: c.expires_at as string | null,
          connectedAt: c.connected_at as string,
        }))}
        accounts={(accounts ?? []).map((a) => ({
          id: a.account_id as string,
          name: a.name as string,
          business: (a.business_name as string | null) ?? "",
          active: a.account_status === 1,
        }))}
        clients={(clients ?? []).map((c) => ({
          id: c.client_id as string,
          name: c.display_name as string,
          accountId: (c.meta_ad_account_id as string | null) ?? null,
        }))}
      />
    </div>
  );
}
