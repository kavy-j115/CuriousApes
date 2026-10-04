"use client";

import { Plus, X } from "lucide-react";
import Select from "../_components/Select";
import ConditionBuilder, { type FieldDef } from "./ConditionBuilder";
import ProductPicker from "./ProductPicker";
import {
  AFFINITY_MODE_LABELS,
  RFM_TIER_LABELS,
  type AffinityMode,
  type ExportShape,
  type RfmParams,
  type RfmTier,
} from "@/lib/segmentRecipes";
import { newGroup, type GroupKind, type SegmentGroup } from "@/lib/segmentGroups";

const numberInput =
  "w-24 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-accent focus:outline-none";

const KIND_LABEL: Record<GroupKind, string> = { rfm: "RFM tiers", affinity: "Product affinity", custom: "Custom" };

// The include / exclude group list used by both the Segments wizard and Product
// Insights. Each group is one rule; the include list is "any of these", the
// exclude list is "then remove anyone who matches any of these".
export default function GroupBuilder({
  mode,
  groups,
  onChange,
  shape,
  products,
  fields,
  defaultParams,
  counts,
}: {
  mode: "include" | "exclude";
  groups: SegmentGroup[];
  onChange: (next: SegmentGroup[]) => void;
  shape: ExportShape;
  products: string[];
  fields: FieldDef[];
  defaultParams: RfmParams;
  counts: number[];
}) {
  const isInclude = mode === "include";
  const needsOrders = shape !== "orders";

  function update(id: string, patch: Partial<SegmentGroup>) {
    onChange(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  return (
    <div className={`rounded-lg border p-3 ${isInclude ? "border-status-good/30" : "border-status-bad/30"}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${isInclude ? "bg-status-good/15 text-status-good" : "bg-status-bad/15 text-status-bad"}`}>
          {isInclude ? "Include" : "Exclude"}
        </span>
        <span className="text-xs text-zinc-400">
          {isInclude
            ? "Customers who match any of these groups. Leave empty to start from everyone."
            : "Then remove customers who match any of these groups."}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {groups.map((g, i) => (
          <div key={g.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-full bg-zinc-900 p-1">
                {(Object.keys(KIND_LABEL) as GroupKind[]).map((k) => {
                  const enabled = k === "custom" || !needsOrders;
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={!enabled}
                      onClick={() => update(g.id, { kind: k })}
                      title={enabled ? undefined : "Needs an Orders export"}
                      className={`rounded-full px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                        g.kind === k ? "bg-zinc-700 text-zinc-50" : "text-zinc-400"
                      }`}
                    >
                      {KIND_LABEL[k]}
                    </button>
                  );
                })}
              </div>
              <span className="text-xs tabular-nums text-zinc-500">{(counts[i] ?? 0).toLocaleString()} match</span>
              <button
                type="button"
                onClick={() => onChange(groups.filter((x) => x.id !== g.id))}
                aria-label="Remove group"
                className="ml-auto rounded p-1 text-zinc-500 hover:bg-status-bad/10 hover:text-status-bad"
              >
                <X size={14} />
              </button>
            </div>

            {g.kind === "rfm" && (
              <div className="flex flex-col gap-3">
                <Select value={g.tier} onChange={(v) => update(g.id, { tier: v as RfmTier })} className="w-fit">
                  {(Object.keys(RFM_TIER_LABELS) as RfmTier[]).map((t) => (
                    <option key={t} value={t}>{RFM_TIER_LABELS[t]}</option>
                  ))}
                </Select>
                <div className="flex flex-wrap items-end gap-4 text-xs text-zinc-400">
                  {g.tier === "vip" && (
                    <label>
                      Orders at least
                      <input type="number" min={1} value={g.params.vipOrders} onChange={(e) => update(g.id, { params: { ...g.params, vipOrders: Number(e.target.value) } })} className={`mt-1 block ${numberInput}`} />
                    </label>
                  )}
                  {(g.tier === "vip" || g.tier === "new" || g.tier === "at_risk") && (
                    <label>
                      {g.tier === "at_risk" ? "Quiet for more than (days)" : "Ordered within (days)"}
                      <input type="number" min={1} value={g.params.recentDays} onChange={(e) => update(g.id, { params: { ...g.params, recentDays: Number(e.target.value) } })} className={`mt-1 block ${numberInput}`} />
                    </label>
                  )}
                  {(g.tier === "at_risk" || g.tier === "lapsed") && (
                    <label>
                      {g.tier === "at_risk" ? "But not longer than (days)" : "No order for more than (days)"}
                      <input type="number" min={1} value={g.params.lapsedDays} onChange={(e) => update(g.id, { params: { ...g.params, lapsedDays: Number(e.target.value) } })} className={`mt-1 block ${numberInput}`} />
                    </label>
                  )}
                  {g.tier === "big_spenders" && (
                    <label>
                      Total spent at least
                      <input type="number" min={0} value={g.params.minSpend} onChange={(e) => update(g.id, { params: { ...g.params, minSpend: Number(e.target.value) } })} className={`mt-1 block ${numberInput}`} />
                    </label>
                  )}
                </div>
              </div>
            )}

            {g.kind === "affinity" && (
              <div className="flex flex-col gap-4">
                <Select value={g.mode} onChange={(v) => update(g.id, { mode: v as AffinityMode })} className="w-fit">
                  {(Object.keys(AFFINITY_MODE_LABELS) as AffinityMode[]).map((m) => (
                    <option key={m} value={m}>{AFFINITY_MODE_LABELS[m]}</option>
                  ))}
                </Select>
                <ProductPicker label="Products" options={products} selected={g.products} onChange={(next) => update(g.id, { products: next })} />
                {g.mode === "bought_not" && (
                  <ProductPicker label="Excluding" options={products} selected={g.excludeProducts} onChange={(next) => update(g.id, { excludeProducts: next })} />
                )}
              </div>
            )}

            {g.kind === "custom" && <ConditionBuilder fields={fields} conditions={g.conditions} onChange={(next) => update(g.id, { conditions: next })} />}
          </div>
        ))}

        {groups.length === 0 && <p className="text-xs text-zinc-500">{isInclude ? "No include groups: everyone is included." : "Nothing excluded."}</p>}

        <button
          type="button"
          onClick={() => onChange([...groups, newGroup(needsOrders ? "custom" : "rfm", defaultParams)])}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-accent hover:text-accent"
        >
          <Plus size={13} />
          Add {isInclude ? "include" : "exclude"} group
        </button>
      </div>
    </div>
  );
}
