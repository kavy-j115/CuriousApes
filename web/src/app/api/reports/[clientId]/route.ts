import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { lastCompleteDay } from "@/lib/dashboardData";
import { ReportRow, computeTotal } from "@/lib/reportMath";
import {
  ALL_METRIC_KEYS,
  attachDerivedColumns,
  resolveReportColumns,
  type ReportConfig,
} from "@/lib/reportColumns";

// The Excel report is built here, on request, from the same daily_report_metrics
// rows and the same column / colour rules as the Reports page -- so the download
// is always the range on screen (this month so far by default) and never depends
// on a file the pipeline may not have produced yet.
//
// Access is decided by the user's own session: both queries below go through the
// RLS-protected client, so a user who can't see this client gets nothing back.

const PCT_KEYS = new Set(["atc_pct", "conversion_pct", "checkout_pct"]);
const INT_KEYS = new Set(["sessions", "add_to_carts", "order_count"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function numFmt(key: string, isPct?: boolean): string {
  if (PCT_KEYS.has(key) || isPct) return "0.0%";
  if (INT_KEYS.has(key)) return "#,##0";
  if (key === "proas") return "0.0";
  return "#,##0.00";
}

// rgba(r,g,b,0.5) from the web gradient, blended over white for a solid Excel fill.
function solidFill(css: string | undefined): string | null {
  const m = css?.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/);
  if (!m) return null;
  const a = Number(m[4]);
  const hex = [m[1], m[2], m[3]].map((v) => Math.round(Number(v) * a + 255 * (1 - a)).toString(16).padStart(2, "0"));
  return `FF${hex.join("").toUpperCase()}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: client } = await supabase
    .from("clients")
    .select("client_id, display_name, report_config, timezone")
    .eq("client_id", clientId)
    .single();
  if (!client) {
    return NextResponse.json({ error: "Not found or not authorized" }, { status: 404 });
  }
  const reportConfig = (client.report_config ?? null) as ReportConfig;

  const search = new URL(request.url).searchParams;
  const fromParam = search.get("from");
  const toParam = search.get("to");
  // Completed days only, same as the Reports page.
  const lastDay = lastCompleteDay(client.timezone);
  const from = fromParam && DATE_RE.test(fromParam) ? fromParam : `${lastDay.slice(0, 8)}01`;
  const requestedTo = toParam && DATE_RE.test(toParam) ? toParam : fromParam && DATE_RE.test(fromParam) ? fromParam : lastDay;
  const to = requestedTo > lastDay ? lastDay : requestedTo;

  const { data, error } = await supabase
    .from("daily_report_metrics")
    .select("*")
    .eq("client_id", clientId)
    .gte("report_date", from)
    .lte("report_date", to)
    .order("report_date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const derived = reportConfig?.derivedColumns;
  const rows = attachDerivedColumns((data as ReportRow[] | null) ?? [], derived);
  if (rows.length === 0) {
    return NextResponse.json({ error: "No data for this range." }, { status: 404 });
  }
  const isSingleDay = from === to;
  const total = isSingleDay ? null : attachDerivedColumns([computeTotal([...rows].reverse())], derived)[0];

  const allRows = total ? [...rows, total] : rows;
  const columns = resolveReportColumns(reportConfig, allRows);
  const derivedKeys = new Map((derived ?? []).map((d) => [d.key, d.isPct]));
  const proasStyle = columns.find((c) => c.key === "proas")?.cellStyle;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Business Health Report");

  ws.mergeCells(1, 1, 1, columns.length);
  const title = ws.getCell(1, 1);
  title.value = `${client.display_name} - Business Health Report (${from === to ? from : `${from} to ${to}`})`;
  title.font = { name: "Arial", bold: true, size: 14 };
  title.alignment = { horizontal: "center" };

  const headerColor = (reportConfig?.headerColor ?? "").replace(/^#/, "");
  const headerArgb = `FF${/^[0-9a-fA-F]{6}$/.test(headerColor) ? headerColor.toUpperCase() : "4472C4"}`;
  const hr = parseInt(headerArgb.slice(2, 4), 16), hg = parseInt(headerArgb.slice(4, 6), 16), hb = parseInt(headerArgb.slice(6, 8), 16);
  const headerText = 0.299 * hr + 0.587 * hg + 0.114 * hb < 150 ? "FFFFFFFF" : "FF000000";
  const thin = { style: "thin" as const, color: { argb: "FF000000" } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  columns.forEach((c, i) => {
    const cell = ws.getCell(3, i + 1);
    cell.value = c.label;
    cell.font = { name: "Arial", bold: true, color: { argb: headerText } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerArgb } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border;
    ws.getColumn(i + 1).width = 16;
  });

  allRows.forEach((row, r) => {
    const isTotal = total !== null && r === allRows.length - 1;
    columns.forEach((c, i) => {
      const cell = ws.getCell(4 + r, i + 1);
      const isMetric = (ALL_METRIC_KEYS as string[]).includes(c.key) || derivedKeys.has(c.key);
      if (c.key === "report_date") {
        cell.value = isTotal ? "Total" : row.report_date;
      } else if (isMetric) {
        const raw = (row as unknown as Record<string, string | number | null>)[c.key];
        cell.value = raw === null || raw === undefined || raw === "" ? null : Number(raw);
        cell.numFmt = numFmt(c.key, derivedKeys.get(c.key));
      }
      if (c.key === "proas") {
        const argb = solidFill(proasStyle?.(row)?.backgroundColor as string | undefined);
        if (argb) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
      }
      cell.font = { name: "Arial", bold: isTotal };
      cell.alignment = { horizontal: "center" };
      cell.border = border;
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `${clientId}_report_${from}_to_${to}.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
