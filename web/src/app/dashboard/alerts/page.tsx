import { createClient } from "@/lib/supabase/server";

const TYPE_STYLES: Record<string, string> = {
  revenue_drop: "bg-red-500/10 text-red-400",
  cac_increase: "bg-red-500/10 text-red-400",
  roas_drop: "bg-red-500/10 text-red-400",
};

function styleFor(alertType: string): string {
  if (TYPE_STYLES[alertType]) return TYPE_STYLES[alertType];
  if (alertType.startsWith("sync_failure")) return "bg-amber-500/10 text-amber-400";
  if (alertType.startsWith("data_quality_")) return "bg-amber-500/10 text-amber-400";
  if (alertType.startsWith("anomaly_")) return "bg-purple-500/10 text-purple-400";
  return "bg-zinc-800 text-zinc-300";
}

function labelFor(alertType: string): string {
  if (alertType.startsWith("sync_failure_")) return `Sync failure: ${alertType.replace("sync_failure_", "")}`;
  if (alertType.startsWith("data_quality_")) return `Data quality: ${alertType.replace("data_quality_", "").replace(/_/g, " ")}`;
  if (alertType.startsWith("anomaly_")) return `Anomaly: ${alertType.replace("anomaly_", "").replace(/_/g, " ")}`;
  return alertType.replace(/_/g, " ");
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  const supabase = await createClient();

  const { data: clients } = await supabase.from("clients").select("client_id, display_name").order("display_name");
  const selectedClient = client ?? clients?.[0]?.client_id ?? "";

  const { data: alerts } = selectedClient
    ? await supabase
        .from("alerts")
        .select("id, alert_date, alert_type, message, notified_at")
        .eq("client_id", selectedClient)
        .order("alert_date", { ascending: false })
        .order("id", { ascending: false })
        .limit(100)
    : { data: [] };

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold text-zinc-50">Alerts</h1>
      <p className="mb-6 text-xs text-zinc-500">Threshold breaches, sync failures, data quality issues, and statistical anomalies, most recent first.</p>

      {(!alerts || alerts.length === 0) && (
        <p className="text-sm text-zinc-500">No alerts for this client yet.</p>
      )}

      <div className="flex flex-col gap-2">
        {(alerts ?? []).map((a) => (
          <div key={a.id} className="flex items-start gap-3 rounded-lg border border-zinc-900 p-3">
            <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium capitalize ${styleFor(a.alert_type)}`}>
              {labelFor(a.alert_type)}
            </span>
            <div className="flex-1">
              <p className="text-sm text-zinc-200">{a.message}</p>
              <p className="mt-0.5 text-xs text-zinc-600">
                {a.alert_date}
                {a.notified_at ? " · sent over WhatsApp" : " · not yet sent"}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
