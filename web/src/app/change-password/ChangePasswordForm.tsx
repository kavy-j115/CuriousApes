"use client";

import { useActionState } from "react";
import { changePassword } from "./actions";

const inputClass =
  "w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-zinc-300";

export default function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [state, formAction, pending] = useActionState(changePassword, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && (
        <p className="rounded border border-red-900 bg-red-950/60 p-3 text-sm text-red-300">{state.error}</p>
      )}
      <div>
        <label className={labelClass}>{forced ? "Temporary password" : "Current password"}</label>
        <input name="current" type="password" required autoComplete="current-password" className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>New password</label>
        <input name="next" type="password" required minLength={10} autoComplete="new-password" placeholder="At least 10 characters" className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Confirm new password</label>
        <input name="confirm" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className="mt-2 w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Saving…" : "Set password"}
      </button>
    </form>
  );
}
