import { supabase } from "@/lib/supabase";
import ClientPicker from "./ClientPicker";

type DailyMetric = {
  client_id: string;
  order_date: string;
  order_count: number;
  gross_revenue: string;
  net_revenue: string;
  aov: string;
  units_sold: number;
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  const selectedClient = client ?? "all";

  const [{ data: clients }, metricsResult] = await Promise.all([
    supabase.from("clients").select("client_id, display_name").order("display_name"),
    (() => {
      let query = supabase.from("daily_business_metrics").select("*").order("order_date", { ascending: false });
      if (selectedClient !== "all") {
        query = query.eq("client_id", selectedClient);
      }
      return query;
    })(),
  ]);

  const { data, error } = metricsResult;

  return (
    <div className="min-h-screen bg-zinc-50 p-8 font-sans dark:bg-black">
      <main className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            D2C Analytics
          </h1>
          <ClientPicker clients={clients ?? []} selected={selectedClient} />
        </div>

        {error && (
          <p className="rounded bg-red-100 p-4 text-red-800">
            Failed to load metrics: {error.message}
          </p>
        )}

        {!error && (!data || data.length === 0) && (
          <p className="text-zinc-600 dark:text-zinc-400">
            No metrics yet for this selection — run the Shopify sync and transform scripts first.
          </p>
        )}

        {!error && data && data.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left dark:border-zinc-700">
                <th className="py-2 pr-4">Client</th>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Orders</th>
                <th className="py-2 pr-4">Gross Revenue</th>
                <th className="py-2 pr-4">Net Revenue</th>
                <th className="py-2 pr-4">AOV</th>
                <th className="py-2 pr-4">Units Sold</th>
              </tr>
            </thead>
            <tbody>
              {(data as DailyMetric[]).map((row) => (
                <tr
                  key={`${row.client_id}-${row.order_date}`}
                  className="border-b border-zinc-200 dark:border-zinc-800"
                >
                  <td className="py-2 pr-4">{row.client_id}</td>
                  <td className="py-2 pr-4">{row.order_date}</td>
                  <td className="py-2 pr-4">{row.order_count}</td>
                  <td className="py-2 pr-4">${row.gross_revenue}</td>
                  <td className="py-2 pr-4">${row.net_revenue}</td>
                  <td className="py-2 pr-4">${row.aov}</td>
                  <td className="py-2 pr-4">{row.units_sold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
