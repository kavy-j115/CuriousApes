"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function PasswordField() {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        name="password"
        type={visible ? "text" : "password"}
        required
        placeholder="Enter your password"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 pr-9 text-sm text-zinc-50 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
