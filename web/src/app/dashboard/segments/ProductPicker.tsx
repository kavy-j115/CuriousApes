"use client";

import { X } from "lucide-react";
import MultiSelect from "../_components/MultiSelect";

// A searchable dropdown with a checkbox per product, for picking several at once from the
// products found in the uploaded file. The list scrolls (it is the shared MultiSelect), a
// "Done" button closes it, and the picked products show underneath as removable chips.
export default function ProductPicker({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-zinc-400">{label}</p>
      <MultiSelect
        unit="product"
        placeholder="Select products"
        options={options.map((o) => ({ id: o, label: o }))}
        selected={selected}
        onChange={onChange}
      />
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <span key={s} className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs text-accent">
              <span className="truncate">{s}</span>
              <button type="button" aria-label={`Remove ${s}`} onClick={() => onChange(selected.filter((x) => x !== s))} className="shrink-0 hover:text-white">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {options.length === 0 && <p className="mt-1.5 text-xs text-zinc-500">No products found in this file.</p>}
    </div>
  );
}
