import { ArrowUp, ArrowDown, type LucideIcon } from "lucide-react";

export default function StatTile({
  icon: Icon,
  label,
  value,
  deltaPct,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  deltaPct: number | null;
}) {
  const up = deltaPct !== null && deltaPct >= 0;
  return (
    <div className="group rounded-xl border border-zinc-900 bg-gradient-to-b from-zinc-950 to-black p-4 shadow-sm transition-colors hover:border-zinc-800">
      <div className="flex items-center gap-1.5 text-zinc-400">
        <Icon size={14} />
        <p className="text-xs font-medium tracking-wide">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-50">{value}</p>
      {deltaPct !== null && (
        <span
          className={`mt-2 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium ${
            up ? "bg-status-good/10 text-status-good" : "bg-status-bad/10 text-status-bad"
          }`}
        >
          {up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
          {Math.abs(deltaPct).toFixed(1)}%
        </span>
      )}
    </div>
  );
}
