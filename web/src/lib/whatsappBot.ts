import crypto from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";

// WhatsApp bot: a client messages the agency's WhatsApp number and gets
// their brand's report as a PNG. Who may see which brand comes ONLY from the
// numbers an admin registered on each client (clients.whatsapp_recipients) --
// never from what the sender types, so guessing a brand name leaks nothing.
// The pictures are rendered by the pipeline (src/reports/whatsapp_reports.py)
// and stored at <client_id>/png/<view>.png; this only looks them up and sends.

const GRAPH_API_VERSION = "v21.0";

const VIEW_LABELS: Record<string, string> = { mtd: "Month to date", "7d": "Last 7 days", yesterday: "Yesterday" };

async function vaultSecret(name: string): Promise<string | null> {
  const { data, error } = await getAdminClient().rpc("get_vault_secret", { p_name: name });
  return error || !data ? null : (data as string);
}

export const getAccessToken = () => vaultSecret("agency.whatsapp.access_token");
export const getAppSecret = () => vaultSecret("agency.whatsapp.app_secret");
export const getVerifyToken = () => vaultSecret("agency.whatsapp.verify_token");

export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const given = header.slice("sha256=".length);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const digits = (s: string) => s.replace(/\D/g, "");

type Brand = { client_id: string; display_name: string };

// Brands this number may see: clients that list it as a WhatsApp number, plus --
// for an agency person's number -- every client (admin) or their assigned
// clients (user; 24-hour collab access counts while it lasts).
async function brandsForNumber(from: string): Promise<Brand[]> {
  const admin = getAdminClient();
  const wanted = digits(from);
  const found = new Map<string, Brand>();
  const add = (c: { client_id: unknown; display_name: unknown }) =>
    found.set(c.client_id as string, { client_id: c.client_id as string, display_name: c.display_name as string });

  const { data: clients } = await admin.from("clients").select("client_id, display_name, whatsapp_recipients");
  for (const c of clients ?? []) {
    if (((c.whatsapp_recipients as string[]) ?? []).some((p) => digits(p) === wanted)) add(c);
  }

  const { data: staff } = await admin.from("user_profiles").select("id, role, phone").in("role", ["admin", "user"]).not("phone", "is", null);
  const person = (staff ?? []).find((s) => digits(s.phone as string) === wanted);
  if (person?.role === "admin") {
    for (const c of clients ?? []) add(c);
  } else if (person) {
    const { data: access } = await admin.from("client_access").select("client_id, expires_at").eq("user_id", person.id);
    const now = Date.now();
    const allowed = new Set(
      (access ?? []).filter((a) => !a.expires_at || new Date(a.expires_at as string).getTime() > now).map((a) => a.client_id as string),
    );
    for (const c of clients ?? []) if (allowed.has(c.client_id as string)) add(c);
  }

  return [...found.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
}

function pickView(text: string): string {
  if (/yesterday/.test(text)) return "yesterday";
  if (/\b(7d|7 ?days?|week|weekly)\b/.test(text)) return "7d";
  return "mtd";
}

const HELP =
  "Send *report* for the month-to-date report, *yesterday* for yesterday, or *7 days* for the last 7 days.";

async function sendMessage(to: string, message: Record<string, unknown>): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = await getAccessToken();
  if (!phoneNumberId || !token) throw new Error("WhatsApp isn't configured (WHATSAPP_PHONE_NUMBER_ID / access token).");
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: digits(to), ...message }),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${await res.text()}`);
}

const sendText = (to: string, body: string) => sendMessage(to, { type: "text", text: { body } });

/** Handles one inbound text message. Never throws -- a failure for one
 * message must not make Meta retry the whole webhook delivery. */
export async function handleIncoming(from: string, rawText: string): Promise<void> {
  try {
    const text = rawText.toLowerCase().trim();
    const brands = await brandsForNumber(from);
    if (brands.length === 0) {
      await sendText(from, "This number isn't registered for reports yet. Please ask your account manager to add it.");
      return;
    }

    let brand: Brand | undefined = brands.length === 1 ? brands[0] : undefined;
    if (!brand) {
      brand = brands.find((b) => text.includes(b.display_name.toLowerCase()) || text.includes(b.client_id.toLowerCase()));
    }
    if (!brand) {
      await sendText(
        from,
        `Which brand? Reply with the brand name, e.g. "${brands[0].display_name} report":\n` +
          brands.map((b) => `• ${b.display_name}`).join("\n"),
      );
      return;
    }

    const isGreeting = /^(hi|hello|hey|help|menu|start)\b/.test(text);
    if (isGreeting) {
      await sendText(from, `Welcome to ${brand.display_name}! ${HELP}`);
      return;
    }

    const view = pickView(text);
    const { data, error } = await getAdminClient().storage.from("reports").createSignedUrl(`${brand.client_id}/png/${view}.png`, 600);
    if (error || !data?.signedUrl) {
      await sendText(from, `The ${VIEW_LABELS[view].toLowerCase()} report isn't ready yet. Reports refresh every morning.`);
      return;
    }
    await sendMessage(from, {
      type: "image",
      image: { link: data.signedUrl, caption: `${brand.display_name} - ${VIEW_LABELS[view]}` },
    });
  } catch (e) {
    console.error("WhatsApp bot error:", e instanceof Error ? e.message : e);
  }
}
