"use client";

// Replaces raw <input type="checkbox"> with one consistent control. Controlled
// via checked/onChange; pass `name` (+ `value`) to also submit with a plain
// <form> -- a hidden input mirrors the checked state.
export default function Checkbox({
  checked,
  onChange,
  label,
  name,
  value,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  name?: string;
  value?: string;
  className?: string;
}) {
  return (
    <label
      onClick={(e) => {
        e.preventDefault();
        onChange(!checked);
      }}
      className={`inline-flex cursor-pointer items-center gap-2 text-sm text-zinc-300 select-none ${className}`}
    >
      {name && checked && <input type="hidden" name={name} value={value ?? "on"} />}
      <span
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          checked ? "border-accent bg-accent" : "border-zinc-700 bg-zinc-950 hover:border-zinc-600"
        }`}
      >
        {checked && (
          <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 text-white">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label}
    </label>
  );
}
