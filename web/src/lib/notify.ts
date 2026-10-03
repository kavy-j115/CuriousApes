// Tiny global toast trigger: any client component can call notify("Saved")
// and the ToastHost mounted in the dashboard shell shows it. Kept as a plain
// window event so it needs no provider wiring in each component.

export type ToastType = "success" | "error";

export function notify(message: string, type: ToastType = "success"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("app-toast", { detail: { message, type } }));
}

// Runs a server action and toasts the outcome: `success` when it finishes,
// the error message when it throws. Returns undefined on failure.
export async function withToast<T>(action: () => Promise<T>, success = "Saved"): Promise<T | undefined> {
  try {
    const result = await action();
    notify(success);
    return result;
  } catch (e) {
    notify(e instanceof Error ? e.message : "Something went wrong.", "error");
    return undefined;
  }
}
