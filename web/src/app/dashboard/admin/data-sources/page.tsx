import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole } from "@/lib/auth/profile";

function lastByClient(rows: { client_id: string; fetched_at: string }[] | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows ?? []) {
    if (!map.has(row.client_id)) map.set(row.client_id, row.fetched_at); // already sorted desc
  }
  return map;
}

function isStale(lastSynced: string, now: number): boolean {
  return (now - new Date(lastSynced).getTime()) / 3_600_000 > 48;
}

function StatusCell({ lastSynced, now }: { lastSynced: string | undefined; now: number }) {
  if (!lastSynced) return <span className="text-zinc-600">never synced</span>;
  return (
    <span className={isStale(lastSynced, now) ? "text-amber-400" : "text-lime-400"}>
      {new Date(lastSynced).toLocaleString()}
    </span>
  );
}

export default async function AdminDataSourcesPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return null;
  assertRole(profile, ["admin"]);

  const [{ data: clients }, shopify, meta, ga4] = await Promise.all([
    supabase.from("clients").select("client_id, display_name").order("display_name"),
    supabase.from("raw_shopify_orders").select("client_id, fetched_at").order("fetched_at", { ascending: false }),
    supabase.from("raw_meta_insights").select("client_id, fetched_at").order("fetched_at", { ascending: false }),
    supabase.from("raw_ga4_sessions").select("client_id, fetched_at").order("fetched_at", { ascending: false }),
  ]);

  const shopifyLast = lastByClient(shopify.data);
  const metaLast = lastByClient(meta.data);
  const ga4Last = lastByClient(ga4.data);
  // This is a Server Component -- it runs once per request, not re-rendered
  // client-side, so Date.now() here has none of the memoization hazards the
  // react-hooks/purity rule guards against on the client.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-xl font-semibold text-zinc-50">Data Sources</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Last time raw data actually landed for each client/source (`fetched_at` on the raw_*
        tables) -- not whether credentials exist in config, since that lives outside the
        database (see docs/secrets.md). A source that&apos;s configured but failing shows up here
        as stale or never-synced, same as one that was never set up.
      </p>

      <div className="overflow-x-auto rounded-lg border border-zinc-900">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-200">
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Shopify</th>
              <th className="px-3 py-2">Meta Ads</th>
              <th className="px-3 py-2">GA4</th>
            </tr>
          </thead>
          <tbody>
            {(clients ?? []).map((c) => (
              <tr key={c.client_id} className="border-b border-zinc-900 text-zinc-300">
                <td className="px-3 py-2 text-zinc-100">{c.display_name}</td>
                <td className="px-3 py-2 text-xs"><StatusCell lastSynced={shopifyLast.get(c.client_id)} now={now} /></td>
                <td className="px-3 py-2 text-xs"><StatusCell lastSynced={metaLast.get(c.client_id)} now={now} /></td>
                <td className="px-3 py-2 text-xs"><StatusCell lastSynced={ga4Last.get(c.client_id)} now={now} /></td>
              </tr>
            ))}
            {(clients ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-zinc-500">No clients yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
