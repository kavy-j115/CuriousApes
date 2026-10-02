import { createClient } from "@/lib/supabase/server";
import DateSelector from "./DateSelector";

export default async function AiReportPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; date?: string }>;
}) {
  const { client, date } = await searchParams;
  const supabase = await createClient();

  const { data: clients } = await supabase.from("clients").select("client_id, display_name").order("display_name");
  const selectedClient = client ?? clients?.[0]?.client_id ?? "";

  const { data: recent } = selectedClient
    ? await supabase
        .from("ai_daily_reports")
        .select("report_date")
        .eq("client_id", selectedClient)
        .order("report_date", { ascending: false })
        .limit(30)
    : { data: [] };

  const selectedDate = date ?? recent?.[0]?.report_date ?? "";

  const { data: report } = selectedClient && selectedDate
    ? await supabase
        .from("ai_daily_reports")
        .select("content, model, generated_at")
        .eq("client_id", selectedClient)
        .eq("report_date", selectedDate)
        .maybeSingle()
    : { data: null };

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">AI Daily Report</h1>
          <p className="text-xs text-zinc-500">AI-generated plain-language read of the day&apos;s numbers.</p>
        </div>
        <DateSelector dates={(recent ?? []).map((r) => r.report_date)} />
      </div>

      {!report && <p className="text-sm text-zinc-500">No AI report generated for this client yet.</p>}

      {report && (
        <div className="rounded-lg border border-zinc-900 bg-black p-5">
          <p className="mb-3 text-xs text-zinc-600">
            {selectedDate} · generated {new Date(report.generated_at).toLocaleString()} · {report.model}
          </p>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{report.content}</div>
        </div>
      )}
    </div>
  );
}
