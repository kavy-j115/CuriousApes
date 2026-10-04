import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";

// React's cache() memoizes per request: the dashboard layout and the page
// rendered inside it both need the session client, the profile and the
// clients list. Each used to fetch its own copy, so every page load paid for
// the same database round trips two or three times -- and with the web
// server far from the database (Mumbai), each round trip is slow.
export const getSupabase = cache(async () => createClient());

export const getProfile = cache(async () => getCurrentProfile(await getSupabase()));

export const getClients = cache(async () => {
  const supabase = await getSupabase();
  const { data } = await supabase
    .from("clients")
    .select("client_id, display_name, report_config, timezone")
    .order("display_name");
  return data ?? [];
});

// Today's date (YYYY-MM-DD) in a client's own time zone -- "last 7 days"
// must mean the store's last 7 days, not UTC's.
export function todayIn(timeZone: string | null | undefined): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC" }).format(new Date());
}

// The latest day that is whole in the client's time zone (yesterday). Reports and
// the dashboard stop here so a half-finished day is never shown.
export function lastCompleteDay(timeZone: string | null | undefined): string {
  return shiftDate(todayIn(timeZone), -1);
}

export function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
