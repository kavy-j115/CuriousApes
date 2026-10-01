"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL_WITH_ARTICLE } from "@/lib/roleTheme";
import type { Role } from "@/lib/auth/profile";

const VALID_ROLES: Role[] = ["client", "user", "admin"];

// No sign-up action deliberately -- user provisioning is admin-side (a
// user_profiles + client_access row created directly, see docs/auth.md),
// not self-service, matching the agency/client access model.
export async function login(formData: FormData) {
  const expectedRole = formData.get("role") as string;
  if (!VALID_ROLES.includes(expectedRole as Role)) {
    redirect("/login");
  }

  const supabase = await createClient();

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });

  if (authError) {
    redirect(`/login/${expectedRole}?error=${encodeURIComponent(authError.message)}`);
  }

  // Which button someone clicked on the selector screen only picks which
  // themed form they see -- it is NOT the authorization check. The real
  // role comes from user_profiles, looked up fresh right here. If it
  // doesn't match what they clicked, the session is torn back down
  // immediately rather than left valid -- a mismatch never grants access,
  // it just gets rejected with a role-specific message.
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;

  const { data: profile } = userId
    ? await supabase.from("user_profiles").select("role").eq("id", userId).single()
    : { data: null };

  if (!profile) {
    await supabase.auth.signOut();
    redirect(
      `/login/${expectedRole}?error=${encodeURIComponent(
        "No access has been configured for this account yet. Contact an admin."
      )}`
    );
  }

  if (profile.role !== expectedRole) {
    await supabase.auth.signOut();
    redirect(
      `/login/${expectedRole}?error=${encodeURIComponent(
        `This is not ${ROLE_LABEL_WITH_ARTICLE[expectedRole as Role]} account.`
      )}`
    );
  }

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
