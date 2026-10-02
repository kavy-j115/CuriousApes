import { getSupabase, getClients } from "@/lib/dashboardData";
import { resolveSelectedClient } from "@/lib/selectedClient";

const TYPE_STYLES: Record<string, string> = {
  revenue_drop: "bg-status-bad/10 text-status-bad",
  cac_increase: "bg-status-bad/10 text-status-bad",
  roas_drop: "bg-status-bad/10 text-status-bad",
};

function styleFor(alertType: string): string {
  if (TYPE_STYLES[alertType]) return TYPE_STYLES[alertType];
  if (alertType.startsWith("sync_failure")) return "bg-status-warning/10 text-status-warning";
  if (alertType.startsWith("data_quality_")) return "bg-status-warning/10 text-status-warning";
  if (alertType.startsWith("anomaly_")) return "bg-accent/10 text-accent";
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
  const supabase = await getSupabase();
  const clients = await getClients();
  const selectedClient = await resolveSelectedClient(client, clients ?? []);

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
      <h1 className="mb-6 text-xl font-semibold text-zinc-50">Alerts</h1>
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
