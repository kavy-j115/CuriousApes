"use client";

import { ChevronDown } from "lucide-react";

// Replaces raw <select> (default OS chrome). Still a native <select>
// underneath (keyboard/a11y/mobile behavior for free) -- only the chrome is
// custom. Controlled (value + onChange) or, for plain <form> submission,
// uncontrolled (name + optional defaultValue).
export default function Select({
  value,
  defaultValue,
  onChange,
  name,
  required,
  children,
  className = "",
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative inline-block ${className}`}>
      <select
        name={name}
        required={required}
        {...(value !== undefined ? { value } : { defaultValue })}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full appearance-none rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-3 pr-8 text-sm text-zinc-200 transition-colors hover:border-zinc-700 focus:border-accent focus:outline-none"
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
    </div>
  );
}
