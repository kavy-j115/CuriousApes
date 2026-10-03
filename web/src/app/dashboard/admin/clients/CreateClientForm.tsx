"use client";

import { useActionState, useEffect, useRef } from "react";
import { notify } from "@/lib/notify";
import { createClientRecord } from "../actions";

type State =
  | { ok: true; login?: { email: string; tempPassword: string }; loginError?: string }
  | { error: string }
  | null;

const inputClass =
  "rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-accent focus:outline-none";
const labelClass = "mb-1 block text-xs font-medium text-zinc-400";

function slugify(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function CreateClientForm() {
  const [state, formAction, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    try {
      return await createClientRecord(formData);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Couldn't add the client." };
    }
  }, null);

  useEffect(() => {
    if (state && "ok" in state) notify("Client added");
    else if (state && "error" in state) notify(state.error, "error");
  }, [state]);

  // The client ID follows the brand name until someone edits it by hand.
  const idRef = useRef<HTMLInputElement>(null);
  const idTouched = useRef(false);

  return (
    <div data-tour="client-create" className="mb-8">
      <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-zinc-800 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={labelClass}>Brand name</label>
            <input
              name="display_name"
              required
              placeholder="Acme Brand"
              className={inputClass}
              onChange={(e) => {
                if (!idTouched.current && idRef.current) idRef.current.value = slugify(e.target.value);
              }}
            />
          </div>
          <div>
            <label className={labelClass}>Client ID</label>
            <input
              ref={idRef}
              name="client_id"
              required
              placeholder="acme-brand"
              className={inputClass}
              onChange={() => {
                idTouched.current = true;
              }}
            />
          </div>
          <div>
            <label className={labelClass}>Client email</label>
            <input name="client_email" type="email" placeholder="owner@brand.com" className={inputClass} />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={labelClass}>Shopify store domain</label>
            <input name="shopify_store_domain" placeholder="brand.myshopify.com" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Meta ad account ID</label>
            <input name="meta_ad_account_id" placeholder="1234567890" className={`w-44 ${inputClass}`} />
          </div>
          <div>
            <label className={labelClass}>GA4 property ID</label>
            <input name="ga4_property_id" placeholder="123456789" className={`w-40 ${inputClass}`} />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={labelClass}>Ideal ROAS</label>
            <input name="ideal_roas" type="number" step="0.1" min="0" placeholder="e.g. 4" className={`w-24 ${inputClass}`} />
          </div>
          <div>
            <label className={labelClass}>Revenue drop alert %</label>
            <input name="revenue_change_pct" type="number" placeholder="off" className={`w-24 ${inputClass}`} />
          </div>
          <div>
            <label className={labelClass}>CAC increase alert %</label>
            <input name="cac_change_pct" type="number" placeholder="off" className={`w-24 ${inputClass}`} />
          </div>
          <div>
            <label className={labelClass}>ROAS drop alert %</label>
            <input name="roas_change_pct" type="number" placeholder="off" className={`w-24 ${inputClass}`} />
          </div>
          <div className="flex-1">
            <label className={labelClass}>Client WhatsApp number(s)</label>
            <input name="whatsapp_recipients" placeholder="+919876543210, +919876543211" className={inputClass} />
          </div>
        </div>

        <button type="submit" disabled={pending} className="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Adding…" : "Add client"}
        </button>
      </form>

      {state && "error" in state && (
        <p className="mt-3 rounded border border-status-bad/30 bg-status-bad/10 p-3 text-sm text-status-bad">{state.error}</p>
      )}
      {state && "ok" in state && (
        <div className="mt-3 rounded border border-status-good/30 bg-status-good/10 p-3 text-sm text-status-good">
          <p className="font-medium">Client added.</p>
          {state.login && (
            <p className="mt-1">
              Login for {state.login.email} -- temporary password: <span className="font-mono">{state.login.tempPassword}</span>
              <span className="text-status-good/80"> (shown once)</span>
            </p>
          )}
          {state.loginError && <p className="mt-1 text-status-warning">The client was added, but their login wasn&apos;t created: {state.loginError}</p>}
        </div>
      )}
    </div>
  );
}
