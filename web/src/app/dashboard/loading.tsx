export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading">
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-accent" />
        Loading…
      </div>
      <div className="h-8 w-56 animate-pulse rounded-md bg-zinc-900" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-900" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl bg-zinc-900" />
    </div>
  );
}
