import { ReportRow, computeTotal, fmtNum, fmtPct } from "@/lib/reportMath";

type MetricSpec = {
  label: string;
  key: keyof ReportRow;
  isPct: boolean;
};

const COMPARE_METRICS: MetricSpec[] = [
  { label: "Sessions", key: "sessions", isPct: false },
  { label: "Cart Adds", key: "add_to_carts", isPct: false },
  { label: "Orders", key: "order_count", isPct: false },
  { label: "Gross Sales", key: "gross_revenue", isPct: false },
  { label: "AOV", key: "aov", isPct: false },
  { label: "Ad Spend", key: "amount_spent", isPct: false },
  { label: "Purchase Value", key: "purchase_value", isPct: false },
  { label: "PROAS", key: "proas", isPct: false },
  { label: "ATC %", key: "atc_pct", isPct: true },
  { label: "Conv %", key: "conversion_pct", isPct: true },
  { label: "Checkout %", key: "checkout_pct", isPct: true },
];

function numOrNull(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

function deltaPct(a: number | null, b: number | null): string {
  if (a === null || b === null || a === 0) return "—";
  return `${(((b - a) / Math.abs(a)) * 100).toFixed(1)}%`;
}

export default function CompareView({
  rowsA,
  rowsB,
  labelA,
  labelB,
}: {
  rowsA: ReportRow[];
  rowsB: ReportRow[];
  labelA: string;
  labelB: string;
}) {
  const totalA = computeTotal(rowsA);
  const totalB = computeTotal(rowsB);

  return (
    <div className="overflow-x-auto">
      <table className="w-full max-w-3xl border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-200">
            <th className="px-3 py-2">Metric</th>
            <th className="px-3 py-2">{labelA}</th>
            <th className="px-3 py-2">{labelB}</th>
            <th className="px-3 py-2">Δ</th>
            <th className="px-3 py-2">Δ %</th>
          </tr>
        </thead>
        <tbody>
          {COMPARE_METRICS.map((m) => {
            const a = numOrNull(totalA[m.key] as string | number | null);
            const b = numOrNull(totalB[m.key] as string | number | null);
            const delta = a !== null && b !== null ? b - a : null;
            const fmt = m.isPct ? fmtPct : fmtNum;
            return (
              <tr key={m.key} className="border-b border-zinc-900 text-zinc-300">
                <td className="px-3 py-1.5 font-medium text-zinc-100">{m.label}</td>
                <td className="px-3 py-1.5">{fmt(a)}</td>
                <td className="px-3 py-1.5">{fmt(b)}</td>
                <td className={`px-3 py-1.5 ${delta !== null && delta > 0 ? "text-lime-400" : delta !== null && delta < 0 ? "text-red-400" : ""}`}>
                  {delta === null ? "—" : m.isPct ? fmtPct(delta) : fmtNum(delta)}
                </td>
                <td className="px-3 py-1.5">{deltaPct(a, b)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-4 text-xs text-zinc-500">
        {labelA}: {rowsA.length} day{rowsA.length === 1 ? "" : "s"} · {labelB}: {rowsB.length} day{rowsB.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}
