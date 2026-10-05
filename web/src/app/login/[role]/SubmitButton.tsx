"use client";

import { useFormStatus } from "react-dom";

// The login button shows that the sign-in is in progress (it takes a few seconds),
// and can't be pressed twice meanwhile.
export default function SubmitButton({ className }: { className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${className} disabled:opacity-70`}>
      {pending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Signing in…
        </span>
      ) : (
        "Login"
      )}
    </button>
  );
}
