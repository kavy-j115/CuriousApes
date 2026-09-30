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
    <div className="rounded-lg border border-zinc-900 bg-black p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-50">{value}</p>
      {deltaPct !== null && (
        <p className={`mt-1 text-xs font-medium ${up ? "text-lime-400" : "text-red-400"}`}>
          {up ? "↑" : "↓"} {Math.abs(deltaPct).toFixed(1)}%
        </p>
      )}
    </div>
  );
}
