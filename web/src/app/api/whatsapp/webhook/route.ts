import { NextResponse, type NextRequest } from "next/server";
import { getAppSecret, getVerifyToken, handleIncoming, verifySignature } from "@/lib/whatsappBot";

// Meta's WhatsApp webhook. GET answers Meta's one-time verification
// handshake; POST receives messages. Reachable without a login (proxy.ts
// exempts it) -- trust comes from Meta's HMAC signature, checked below.

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const expected = await getVerifyToken();
  if (p.get("hub.mode") === "subscribe" && expected && p.get("hub.verify_token") === expected) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

type InboundMessage = { from?: string; type?: string; text?: { body?: string } };

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const appSecret = await getAppSecret();
  if (!appSecret || !verifySignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: { entry?: { changes?: { value?: { messages?: InboundMessage[] } }[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  const messages = (payload.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.messages ?? []));
  for (const m of messages) {
    if (m.from) await handleIncoming(m.from, m.type === "text" ? (m.text?.body ?? "") : "help");
  }
  return new NextResponse("ok", { status: 200 });
}
