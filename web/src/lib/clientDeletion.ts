import { getAdminClient } from "@/lib/supabase/admin";

// Removes a client completely: the client, ALL its stored data, its saved credentials in Vault,
// its report files, and any client login that had access to nothing else. Never touches
// Shopify or Meta. The callers decide who may trigger it: an admin (deleteClientRecord) or
// Shopify's own signed "shop/redact" privacy webhook.
export async function deleteClientEverything(clientId: string): Promise<void> {
  const admin = getAdminClient();

  // Client logins that only ever had access to this client (looked up BEFORE deleting).
  const { data: access } = await admin.from("client_access").select("user_id").eq("client_id", clientId);
  const candidateIds = (access ?? []).map((a) => a.user_id as string);
  const { data: clientLogins } = candidateIds.length
    ? await admin.from("user_profiles").select("id").eq("role", "client").in("id", candidateIds)
    : { data: [] as { id: string }[] };

  const { error } = await admin.rpc("delete_client_completely", { p_client_id: clientId });
  if (error) throw new Error(error.message);

  // Best-effort cleanup after the database part succeeded.
  for (const login of clientLogins ?? []) {
    const { count } = await admin.from("client_access").select("user_id", { count: "exact", head: true }).eq("user_id", login.id);
    if (!count) await admin.auth.admin.deleteUser(login.id as string);
  }
  try {
    const storage = admin.storage.from("reports");
    const paths: string[] = [];
    const walk = async (prefix: string) => {
      const { data } = await storage.list(prefix, { limit: 1000 });
      for (const item of data ?? []) {
        const full = `${prefix}/${item.name}`;
        if (item.id) paths.push(full);
        else await walk(full);
      }
    };
    await walk(clientId);
    if (paths.length) await storage.remove(paths);
  } catch {
    // report files left behind are harmless; the database part is what matters
  }
}
