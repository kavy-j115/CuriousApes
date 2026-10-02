import { ArrowUp, ArrowDown } from "lucide-react";

export default function StatTile({
  label,
  value,
  deltaPct,
}: {
  label: string;
  value: string;
  deltaPct: number | null;
}) {
  const up = deltaPct !== null && deltaPct >= 0;
  return (
    <div className="group rounded-xl border border-zinc-900 bg-gradient-to-b from-zinc-950 to-black p-4 shadow-sm transition-colors hover:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-zinc-50">{value}</p>
      {deltaPct !== null && (
        <span
          className={`mt-2 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium ${
            up ? "bg-lime-400/10 text-lime-400" : "bg-red-400/10 text-red-400"
          }`}
        >
          {up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
          {Math.abs(deltaPct).toFixed(1)}%
        </span>
      )}
    </div>
  );
}
