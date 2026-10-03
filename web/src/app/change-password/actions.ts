"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

const MIN_PASSWORD_LENGTH = 10;

type State = { error: string } | null;

// Changes the CURRENT user's own password. The current password is checked
// first (a signed-in session alone isn't enough to change it), then the new
// one is set and the "must change" flag is cleared. That flag lives on
// user_profiles, which has no self-update policy, so it is cleared with the
// service role -- always for the session user's own id, never one passed in.
export async function changePassword(_prev: State, formData: FormData): Promise<State> {
  const current = (formData.get("current") as string) ?? "";
  const next = (formData.get("next") as string) ?? "";
  const confirm = (formData.get("confirm") as string) ?? "";

  if (next.length < MIN_PASSWORD_LENGTH) return { error: `The new password needs at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (next !== confirm) return { error: "The two new passwords don't match." };
  if (next === current) return { error: "Choose a password different from the current one." };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;
  const email = claims?.claims?.email as string | undefined;
  if (!userId || !email) redirect("/login");

  const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: current });
  if (verifyError) return { error: "The current password is wrong." };

  const { error: updateError } = await supabase.auth.updateUser({ password: next });
  if (updateError) return { error: updateError.message };

  try {
    await getAdminClient().from("user_profiles").update({ must_change_password: false }).eq("id", userId);
  } catch {
    return { error: "Password changed, but the account couldn't be updated. Sign out and back in." };
  }

  redirect("/dashboard");
}
