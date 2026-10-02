import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Two-step authorization, not one: the user's own session (via the normal
// RLS-protected client) decides WHETHER they can have this file; a
// privileged key then FETCHES it server-side. The service role key is never
// used to decide access -- only to do the fetch once access is already
// proven, and it never reaches the browser (this whole handler runs on the
// server only).
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // RLS decides this, not application logic: if the current user isn't
  // admin and has no client_access row for this client, this query returns
  // nothing regardless of whether the client_id is real.
  const { data: client } = await supabase
    .from("clients")
    .select("client_id")
    .eq("client_id", clientId)
    .single();

  if (!client) {
    return NextResponse.json({ error: "Not found or not authorized" }, { status: 404 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Report storage not configured yet (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)" },
      { status: 503 }
    );
  }

  // daily = the full report the pipeline writes each run; weekly/monthly are
  // the last-7-day / last-30-day summaries it writes alongside it
  // (src/reports/summaries.py). Whitelisted -- never a caller-built path.
  const type = new URL(request.url).searchParams.get("type") ?? "daily";
  const files: Record<string, { path: string; name: string }> = {
    daily: { path: `${clientId}/${clientId}_business_health_report.xlsx`, name: `${clientId}_business_health_report.xlsx` },
    weekly: { path: `${clientId}/summary/weekly.xlsx`, name: `${clientId}_weekly_report.xlsx` },
    monthly: { path: `${clientId}/summary/monthly.xlsx`, name: `${clientId}_monthly_report.xlsx` },
  };
  const file = files[type];
  if (!file) {
    return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
  }
  const filename = file.name;
  const storageResponse = await fetch(
    `${supabaseUrl}/storage/v1/object/reports/${file.path}`,
    {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
    }
  );

  if (!storageResponse.ok) {
    return NextResponse.json(
      { error: `Report not found in storage (has the pipeline run for this client yet?)` },
      { status: 404 }
    );
  }

  return new NextResponse(storageResponse.body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
