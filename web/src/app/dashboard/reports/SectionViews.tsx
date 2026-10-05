import {
  type LandingTable,
  type MonthlyRow,
  type OrdersWeek,
  type ProductShareTable,
  type RtoDay,
  scaleColor,
} from "@/lib/reportSections";

const fmtInt = (n: number) => n.toLocaleString("en-IN");
const fmtPct = (v: number | null, digits = 0) => (v === null ? "—" : `${(v * 100).toFixed(digits)}%`);
const fmtMoney = (n: number | null) => (n === null ? "—" : Math.round(n).toLocaleString("en-IN"));

const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400 whitespace-nowrap";
const td = "px-3 py-1.5 tabular-nums text-zinc-200 whitespace-nowrap";

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-1 text-sm font-semibold text-zinc-100">{title}</h2>
      {note && <p className="mb-2 text-xs text-zinc-500">{note}</p>}
      <div className="overflow-x-auto scrollbar-thin rounded-xl border border-zinc-800">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">{children}</p>;
}

// ---- Orders summary: metrics down the side, weeks across (newest first) ----
export function OrdersSummary({ weeks }: { weeks: OrdersWeek[] }) {
  if (weeks.every((w) => w.orders === 0)) return <Empty>No orders in these weeks for this client.</Empty>;
  type Row = { label: string; cell: (w: OrdersWeek) => string; strong?: boolean };
  const groups: { title: string; note?: string; rows: Row[] }[] = [
    {
      title: "New vs repeat",
      note: "A repeat order is from a customer who ordered before, within the order history we hold for this client.",
      rows: [
        { label: "Orders", cell: (w) => fmtInt(w.orders), strong: true },
        { label: "Repeat", cell: (w) => fmtInt(w.repeat) },
        { label: "New", cell: (w) => fmtInt(w.fresh) },
        { label: "Repeat %", cell: (w) => fmtPct(w.orders ? w.repeat / w.orders : null) },
      ],
    },
    {
      title: "Items per order",
      rows: [
        { label: "Orders", cell: (w) => fmtInt(w.orders), strong: true },
        { label: "1 item", cell: (w) => fmtInt(w.single) },
        { label: "More than 1", cell: (w) => fmtInt(w.multi) },
        { label: "More than 1 %", cell: (w) => fmtPct(w.orders ? w.multi / w.orders : null) },
      ],
    },
    {
      title: "Order value: up to 5,000 and above",
      rows: [
        { label: "Orders", cell: (w) => fmtInt(w.orders), strong: true },
        { label: "Up to 5,000", cell: (w) => fmtInt(w.upTo5000) },
        { label: "Above 5,000", cell: (w) => fmtInt(w.over5000) },
        { label: "Above 5,000 %", cell: (w) => fmtPct(w.orders ? w.over5000 / w.orders : null) },
        { label: "AOV", cell: (w) => fmtMoney(w.aov) },
      ],
    },
    {
      title: "Paid and others",
      note: "Paid = payment received. Others = pending (for example cash on delivery), partly paid, voided or refunded.",
      rows: [
        { label: "Orders", cell: (w) => fmtInt(w.orders), strong: true },
        { label: "Paid", cell: (w) => fmtInt(w.paid) },
        { label: "Others", cell: (w) => fmtInt(w.others) },
        { label: "Paid %", cell: (w) => fmtPct(w.orders ? w.paid / w.orders : null) },
      ],
    },
  ];
  return (
    <>
      {groups.map((g) => (
        <Card key={g.title} title={g.title} note={g.note}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className={th}>Week</th>
                {weeks.map((w) => (
                  <th key={w.week.start} className={th} title={w.week.partial ? "Week still in progress (completed days only)" : undefined}>
                    {w.week.label}
                    {w.week.partial ? " *" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.label} className="border-b border-zinc-900">
                  <td className={`${td} ${r.strong ? "font-semibold" : "text-zinc-400"}`}>{r.label}</td>
                  {weeks.map((w) => (
                    <td key={w.week.start} className={`${td} text-right`}>
                      {r.cell(w)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
      <p className="text-xs text-zinc-500">* week still in progress. Only completed days are counted.</p>
    </>
  );
}

// ---- Product sales share ----
export function ProductShare({ table }: { table: ProductShareTable }) {
  if (table.rows.length === 0) return <Empty>No product sales in these weeks for this client.</Empty>;
  const maxShare = Math.max(...table.rows.flatMap((r) => r.shares.map((s) => s ?? 0)), 0.0001);
  return (
    <Card title="Share of gross sales by product" note="Each week adds up to 100% across all products; the top products are listed. Gross sales = price × quantity of the order lines.">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900">
            <th className={th}>Product</th>
            {table.weeks.map((w) => (
              <th key={w.start} className={th}>
                {w.label}
                {w.partial ? " *" : ""}
              </th>
            ))}
            <th className={th}>Total</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.title} className="border-b border-zinc-900">
              <td className="max-w-xs truncate px-3 py-1.5 text-zinc-200" title={r.title}>
                {r.title}
              </td>
              {r.shares.map((s, i) => (
                <td key={i} className={`${td} text-right`} style={{ background: s ? `hsl(210 60% 45% / ${Math.min(0.55, (s / maxShare) * 0.55)})` : undefined }}>
                  {fmtPct(s, 1)}
                </td>
              ))}
              <td className={`${td} text-right font-semibold`}>{fmtPct(r.total, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ---- Landing pages ----
function Heads() {
  return (
    <>
      <th className={`${th} text-right`}>Share</th>
      <th className={`${th} text-right`}>ATC %</th>
    </>
  );
}

function Cells({ share, atc, bold }: { share: number | null; atc: number | null; bold?: boolean }) {
  return (
    <>
      <td className={`${td} text-right ${bold ? "font-semibold" : ""}`}>{fmtPct(share, 1)}</td>
      <td className={`${td} text-right ${bold ? "font-semibold" : ""}`}>{fmtPct(atc, 1)}</td>
    </>
  );
}

export function LandingPages({ table, hasData }: { table: LandingTable; hasData: boolean }) {
  if (!hasData || table.rows.length === 0) {
    return <Empty>No landing page data yet. It is loaded by the daily sync, so it appears after the next run for this client.</Empty>;
  }
  return (
    <Card title="Landing pages by month" note="Share = the page's part of the month's sessions. ATC % = sessions with an add to cart divided by the page's sessions.">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900">
            <th className={th} rowSpan={2}>
              Landing page
            </th>
            {table.months.map((m) => (
              <th key={m.month} className={`${th} text-center`} colSpan={2}>
                {m.label}
              </th>
            ))}
            <th className={`${th} text-center`} colSpan={2}>
              Total
            </th>
          </tr>
          <tr className="border-b border-zinc-800 bg-zinc-900">
            {[...table.months.map((m) => m.month), "total"].map((k) => (
              <Heads key={k} />
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.path} className="border-b border-zinc-900">
              <td className="max-w-sm truncate px-3 py-1.5 font-mono text-xs text-zinc-200" title={r.path}>
                {r.path}
              </td>
              {r.cells.map((c, i) => (
                <Cells key={i} share={c.share} atc={c.atc} />
              ))}
              <Cells share={r.totalShare} atc={r.totalAtc} bold />
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ---- Monthly business health ----
export function MonthlyHealth({ rows, total }: { rows: MonthlyRow[]; total: MonthlyRow }) {
  const shown = rows.filter((r) => r.sessions > 0 || r.orders > 0);
  if (shown.length === 0) return <Empty>No monthly data for this client yet.</Empty>;
  const line = (r: MonthlyRow, strong?: boolean) => (
    <tr key={r.label} className={`border-b border-zinc-900 ${strong ? "bg-zinc-900 font-semibold" : ""}`}>
      <td className={`${td} text-left`}>{r.label}</td>
      <td className={`${td} text-right`}>{fmtInt(r.sessions)}</td>
      <td className={`${td} text-right`}>{fmtInt(r.cartSessions)}</td>
      <td className={`${td} text-right`}>{fmtInt(r.orders)}</td>
      <td className={`${td} text-right`}>{fmtMoney(r.gross)}</td>
      <td className={`${td} text-right`}>{fmtPct(r.atcPct, 1)}</td>
      <td className={`${td} text-right`}>{fmtPct(r.convPct, 1)}</td>
      <td className={`${td} text-right`}>{fmtPct(r.checkoutPct, 1)}</td>
    </tr>
  );
  return (
    <Card
      title="Monthly business health"
      note="Months run from the history we hold for this client; the current month counts completed days only. Checkout % = orders divided by sessions with a cart addition."
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900">
            {["Month", "Sessions", "Sessions with cart additions", "Orders", "Gross sales", "ATC %", "Conversion %", "Checkout %"].map((h, i) => (
              <th key={h} className={`${th} ${i === 0 ? "" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => line(r))}
          {line(total, true)}
        </tbody>
      </table>
    </Card>
  );
}

// ---- RTO % ----
export function RtoView({ days, total, name }: { days: RtoDay[]; total: RtoDay; name: string }) {
  if (days.length === 0) return <Empty>No orders in this range.</Empty>;
  const rtoVals = days.map((d) => d.rtoPct).filter((v): v is number => v !== null);
  const canVals = days.map((d) => d.cancelPct).filter((v): v is number => v !== null);
  const rtoMin = Math.min(...rtoVals);
  const rtoMax = Math.max(...rtoVals);
  const canMin = Math.min(...canVals);
  const canMax = Math.max(...canVals);
  const fmtDate = (iso: string) => iso.split("-").reverse().join("-");
  return (
    <Card
      title={`${name} RTO %`}
      note="RTO % = orders whose payment is still pending (cash on delivery) divided by the day's orders. Cancellation check = orders cancelled before payment (voided). Both come from Shopify's order status."
    >
      <table className="w-full max-w-3xl border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900">
            {["Date", "Orders", "RTO", "Sum of Cancellation Check", "Cancellation Check %"].map((h, i) => (
              <th key={h} className={`${th} ${i === 0 ? "" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date} className="border-b border-zinc-900">
              <td className={td}>{fmtDate(d.date)}</td>
              <td className={`${td} text-right`}>{fmtInt(d.orders)}</td>
              <td className={`${td} text-right`} style={{ background: scaleColor(d.rtoPct, rtoMin, rtoMax) }}>
                {fmtPct(d.rtoPct)}
              </td>
              <td className={`${td} text-right`}>{fmtInt(d.cancel)}</td>
              <td className={`${td} text-right`} style={{ background: scaleColor(d.cancelPct, canMin, canMax) }}>
                {fmtPct(d.cancelPct)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-zinc-700 bg-zinc-900 font-semibold">
            <td className={td}>{total.date}</td>
            <td className={`${td} text-right`}>{fmtInt(total.orders)}</td>
            <td className={`${td} text-right`}>{fmtPct(total.rtoPct)}</td>
            <td className={`${td} text-right`}>{fmtInt(total.cancel)}</td>
            <td className={`${td} text-right`}>{fmtPct(total.cancelPct)}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}
