export default function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-zinc-50">{title}</h1>
      <p className="mb-6 text-sm text-zinc-500">{description}</p>
      <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-600">
        Coming soon.
      </div>
    </div>
  );
}
