import { Construction } from "lucide-react";

export default function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-zinc-50">{title}</h1>
      <p className="mb-6 text-sm text-zinc-500">{description}</p>
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-800 p-10 text-center">
        <Construction size={22} className="text-zinc-700" />
        <p className="text-sm text-zinc-600">Coming soon.</p>
      </div>
    </div>
  );
}
