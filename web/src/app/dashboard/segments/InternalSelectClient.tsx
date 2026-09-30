"use client";

import { useState } from "react";
import Papa from "papaparse";
import { searchCustomers, searchProducts, customersByProducts, type CustomerCandidate, type ProductCandidate } from "./dataActions";
import { CUSTOMER_FIELDS, type CustomerCondition } from "@/lib/segmentFields";
import { splitPhone, toConvertWayCsv, type CleanedCustomer } from "@/lib/segmentRecipes";
import ConditionBuilder, { type Condition } from "./ConditionBuilder";

type Basis = "customers" | "products";
type Format = "convertway" | "detailed";
const STEPS = ["Select", "Format", "Name", "Download"] as const;

const inputClass =
  "rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-sky-500 focus:outline-none";

export default function InternalSelectClient({ clientId }: { clientId: string }) {
  const [step, setStep] = useState(0);
  const [basis, setBasis] = useState<Basis>("customers");
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<ProductCandidate[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [candidates, setCandidates] = useState<CustomerCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<Format>("convertway");
  const [name, setName] = useState("");

  async function loadProducts() {
    setLoading(true);
    setProducts(await searchProducts(clientId));
    setLoading(false);
  }

  async function runCustomerSearch() {
    setLoading(true);
    const results = await searchCustomers(clientId, conditions as CustomerCondition[]);
    setCandidates(results);
    setSelected(new Set(results.map((r) => r.customer_id)));
    setLoading(false);
  }

  async function runProductSearch() {
    setLoading(true);
    const results = await customersByProducts(clientId, Array.from(selectedProducts));
    setCandidates(results);
    setSelected(new Set(results.map((r) => r.customer_id)));
    setLoading(false);
  }

  function toggleCandidate(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleProduct(title: string) {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  const selectedCandidates = candidates.filter((c) => selected.has(c.customer_id));

  function buildConvertWay(): { customers: CleanedCustomer[]; skippedNoPhone: number; skippedInvalid: number } {
    const customers: CleanedCustomer[] = [];
    let skippedNoPhone = 0;
    let skippedInvalid = 0;
    for (const c of selectedCandidates) {
      if (!c.phone) {
        skippedNoPhone++;
        continue;
      }
      const split = splitPhone(c.phone);
      if (!split) {
        skippedInvalid++;
        continue;
      }
      customers.push({
        phone: split.national,
        countryCode: split.countryCode,
        email: c.email ?? "",
        firstName: c.first_name ?? "",
        lastName: c.last_name ?? "",
      });
    }
    return { customers, skippedNoPhone, skippedInvalid };
  }

  function download() {
    const filename = `${(name || "segment").replace(/\s+/g, "_")}.csv`;
    let csv: string;
    if (format === "convertway") {
      csv = toConvertWayCsv(buildConvertWay().customers);
    } else {
      csv = Papa.unparse(
        selectedCandidates.map((c) => ({
          email: c.email ?? "",
          phone: c.phone ?? "",
          first_name: c.first_name ?? "",
          last_name: c.last_name ?? "",
          order_count: c.order_count,
          lifetime_value: c.lifetime_value,
          last_order_date: c.last_order_date,
        }))
      );
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-1 text-xs text-zinc-500">
        {STEPS.map((s, i) => (
          <span key={s} className={`rounded-full px-2 py-0.5 ${i === step ? "bg-sky-500/20 text-sky-400" : ""}`}>
            {i + 1}. {s}
          </span>
        ))}
      </div>

      {step === 0 && (
        <div>
          <div className="mb-3 flex gap-1 rounded-full bg-zinc-900 p-1 w-fit">
            {(["customers", "products"] as Basis[]).map((b) => (
              <button
                key={b}
                onClick={() => {
                  setBasis(b);
                  setCandidates([]);
                  if (b === "products" && products.length === 0) loadProducts();
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${basis === b ? "bg-zinc-700 text-zinc-50" : "text-zinc-400"}`}
              >
                {b}
              </button>
            ))}
          </div>

          {basis === "customers" && (
            <div className="mb-4">
              <ConditionBuilder fields={CUSTOMER_FIELDS} conditions={conditions} onChange={setConditions} />
              <button
                onClick={runCustomerSearch}
                disabled={loading}
                className="mt-3 rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {loading ? "Searching…" : conditions.length > 0 ? "Search" : "Show all customers"}
              </button>
            </div>
          )}

          {basis === "products" && candidates.length === 0 && (
            <div className="mb-4">
              {loading && <p className="text-sm text-zinc-500">Loading products…</p>}
              {!loading && (
                <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-800">
                  {products.map((p) => (
                    <label key={p.title} className="flex items-center justify-between gap-2 border-b border-zinc-900 px-3 py-1.5 text-xs text-zinc-300 last:border-0">
                      <span className="flex items-center gap-2">
                        <input type="checkbox" checked={selectedProducts.has(p.title)} onChange={() => toggleProduct(p.title)} />
                        {p.title}
                      </span>
                      <span className="text-zinc-500">{p.units_sold} sold · {p.distinct_customers} customers</span>
                    </label>
                  ))}
                  {products.length === 0 && <p className="p-3 text-xs text-zinc-500">No product data yet.</p>}
                </div>
              )}
              {selectedProducts.size > 0 && (
                <button onClick={runProductSearch} disabled={loading} className="mt-3 rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                  Find customers who bought these ({selectedProducts.size})
                </button>
              )}
            </div>
          )}

          {candidates.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-zinc-500">{selected.size} of {candidates.length} selected</p>
              <div className="mb-4 max-h-64 overflow-y-auto rounded-md border border-zinc-800">
                {candidates.map((c) => (
                  <label key={c.customer_id} className="flex items-center justify-between gap-2 border-b border-zinc-900 px-3 py-1.5 text-xs text-zinc-300 last:border-0">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={selected.has(c.customer_id)} onChange={() => toggleCandidate(c.customer_id)} />
                      {c.first_name || c.last_name ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() : c.email || c.customer_id}
                    </span>
                    <span className="text-zinc-500">{c.order_count} orders · {c.lifetime_value.toLocaleString()}</span>
                  </label>
                ))}
              </div>
              <button
                onClick={() => setStep(1)}
                disabled={selected.size === 0}
                className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Continue ({selected.size})
              </button>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="radio" checked={format === "convertway"} onChange={() => setFormat("convertway")} />
            ConvertWay CSV (phone, email, name, country code)
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="radio" checked={format === "detailed"} onChange={() => setFormat("detailed")} />
            Detailed CSV (all fields: orders, lifetime value, last order date)
          </label>
          <div className="mt-2 flex gap-2">
            <button onClick={() => setStep(0)} className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-300">Back</button>
            <button onClick={() => setStep(2)} className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white">Continue</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Segment name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali VIP customers" className={`w-72 ${inputClass}`} />
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => setStep(1)} className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-300">Back</button>
            <button onClick={() => setStep(3)} className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white">Continue</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <p className="mb-2 text-sm text-zinc-200">
            <span className="font-semibold">{name || "Untitled segment"}</span> -- {selectedCandidates.length} customers selected
          </p>
          {format === "convertway" && (
            <p className="mb-3 text-xs text-zinc-500">
              {(() => {
                const { customers, skippedNoPhone, skippedInvalid } = buildConvertWay();
                return `${customers.length} will export (${skippedNoPhone} skipped: no phone, ${skippedInvalid} skipped: invalid phone)`;
              })()}
            </p>
          )}
          <div className="mb-4 overflow-x-auto rounded-md border border-zinc-800">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-400">
                  {format === "convertway"
                    ? ["phone", "email", "first name", "last name", "country code"].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)
                    : ["email", "phone", "first_name", "last_name", "order_count", "lifetime_value"].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {selectedCandidates.slice(0, 5).map((c) => (
                  <tr key={c.customer_id} className="border-b border-zinc-900 text-zinc-300 last:border-0">
                    {format === "convertway" ? (
                      <>
                        <td className="px-2 py-1">{c.phone ?? "—"}</td>
                        <td className="px-2 py-1">{c.email ?? "—"}</td>
                        <td className="px-2 py-1">{c.first_name ?? "—"}</td>
                        <td className="px-2 py-1">{c.last_name ?? "—"}</td>
                        <td className="px-2 py-1">—</td>
                      </>
                    ) : (
                      <>
                        <td className="px-2 py-1">{c.email ?? "—"}</td>
                        <td className="px-2 py-1">{c.phone ?? "—"}</td>
                        <td className="px-2 py-1">{c.first_name ?? "—"}</td>
                        <td className="px-2 py-1">{c.last_name ?? "—"}</td>
                        <td className="px-2 py-1">{c.order_count}</td>
                        <td className="px-2 py-1">{c.lifetime_value}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-300">Back</button>
            <button onClick={download} className="rounded bg-lime-400 px-4 py-2 text-sm font-medium text-black">Download CSV</button>
          </div>
        </div>
      )}
    </div>
  );
}
