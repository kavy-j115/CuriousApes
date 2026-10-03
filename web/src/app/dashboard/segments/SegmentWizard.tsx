"use client";

import { useMemo, useState } from "react";
import { Upload, Check, Download } from "lucide-react";
import Select from "../_components/Select";
import ConditionBuilder, { type Condition } from "./ConditionBuilder";
import ProductPicker from "./ProductPicker";
import { CUSTOMER_FRIENDLY_FIELDS, ORDER_FRIENDLY_FIELDS } from "@/lib/segmentFriendlyFields";
import {
  parseExport,
  detectShape,
  buildOrderProfiles,
  distinctProducts,
  rfmRecipe,
  suggestMinSpend,
  DEFAULT_RFM_PARAMS,
  RFM_TIER_LABELS,
  affinityRecipe,
  AFFINITY_MODE_LABELS,
  customRecipe,
  parseTemplateHeaders,
  guessField,
  buildOutput,
  buildListCsv,
  OUTPUT_FIELDS,
  type ExportRow,
  type ExportShape,
  type RfmTier,
  type RfmParams,
  type AffinityMode,
  type OutputField,
  type SegmentCustomer,
} from "@/lib/segmentRecipes";

type Kind = "rfm" | "affinity" | "custom";
type Loaded = { name: string; shape: ExportShape; rows: ExportRow[] };
type Template = { name: string; headers: string[] };

const numberInput =
  "w-24 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-accent focus:outline-none";
const count = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
const primaryButton = "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40";

function StepCard({
  n,
  title,
  active,
  reached,
  summary,
  onEdit,
  children,
}: {
  n: number;
  title: string;
  active: boolean;
  reached: boolean;
  summary?: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  const done = reached && !active;
  return (
    <section className={`rounded-xl border bg-zinc-950 ${active ? "border-zinc-800" : "border-zinc-900"}`}>
      <header className="flex items-center gap-3 px-4 py-3">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            active ? "bg-accent text-white" : done ? "bg-accent/15 text-accent" : "bg-zinc-900 text-zinc-600"
          }`}
        >
          {done ? <Check size={13} /> : n}
        </span>
        <h2 className={`text-sm font-medium ${active || done ? "text-zinc-100" : "text-zinc-600"}`}>{title}</h2>
        {done && summary && <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{summary}</span>}
        {done && (
          <button onClick={onEdit} className="ml-auto text-xs text-accent hover:underline">
            Change
          </button>
        )}
      </header>
      {active && <div className="border-t border-zinc-900 px-4 py-4">{children}</div>}
    </section>
  );
}

export default function SegmentWizard() {
  const [step, setStep] = useState(1);
  const [reached, setReached] = useState(1);

  const [file, setFile] = useState<Loaded | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>("rfm");
  const [tier, setTier] = useState<RfmTier>("vip");
  const [params, setParams] = useState<RfmParams>(DEFAULT_RFM_PARAMS);
  const [mode, setMode] = useState<AffinityMode>("bought_any");
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);

  const [template, setTemplate] = useState<Template | null>(null);
  const [mapping, setMapping] = useState<(OutputField | "")[]>([]);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const profiles = useMemo(() => (file?.shape === "orders" ? buildOrderProfiles(file.rows) : null), [file]);
  const products = useMemo(() => (file?.shape === "orders" ? distinctProducts(file.rows) : []), [file]);

  const segment: SegmentCustomer[] = useMemo(() => {
    if (!file) return [];
    if (kind === "custom") {
      const usable = conditions.filter((c) => c.value.trim() !== "").map((c) => ({ column: c.field, operator: c.operator, value: c.value }));
      return customRecipe(file.rows, usable, file.shape);
    }
    if (!profiles) return [];
    if (kind === "rfm") return rfmRecipe(profiles, tier, params);
    return affinityRecipe(profiles, mode, include, exclude);
  }, [file, kind, conditions, profiles, tier, params, mode, include, exclude]);

  const output = useMemo(
    () => (template ? buildOutput(segment, template.headers, mapping) : null),
    [segment, template, mapping]
  );

  function goTo(n: number) {
    setStep(n);
    setReached((r) => Math.max(r, n));
  }

  async function handleFile(f: File | undefined) {
    if (!f) return;
    setFileError(null);
    const { rows, headers } = parseExport(await f.text());
    const shape = detectShape(headers);
    if (!shape) {
      setFileError("This doesn't look like a Shopify Orders or Customers export.");
      return;
    }
    setFile({ name: f.name, shape, rows });
    setConditions([]);
    setInclude([]);
    setExclude([]);
    if (shape === "customers") setKind("custom");
    else {
      setKind((k) => (k === "custom" ? "rfm" : k));
      setParams((p) => ({ ...p, minSpend: suggestMinSpend(buildOrderProfiles(rows)) }));
    }
    goTo(2);
  }

  async function handleTemplate(f: File | undefined) {
    if (!f) return;
    setTemplateError(null);
    const headers = parseTemplateHeaders(await f.text());
    if (headers.length === 0) {
      setTemplateError("Couldn't find a header row in this file.");
      return;
    }
    setTemplate({ name: f.name, headers });
    setMapping(headers.map(guessField));
  }

  function saveCsv(csv: string, filename: string) {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function download() {
    if (!output) return;
    saveCsv(output.csv, `${kind}_segment.csv`);
  }

  // Straight from the segment step: the whole list, no output template needed.
  function downloadList() {
    saveCsv(buildListCsv(segment), `${kind}_segment_list.csv`);
  }

  const fields = file?.shape === "customers" ? CUSTOMER_FRIENDLY_FIELDS : ORDER_FRIENDLY_FIELDS;
  const kinds: { key: Kind; label: string; enabled: boolean }[] = [
    { key: "rfm", label: "RFM tiers", enabled: file?.shape === "orders" },
    { key: "affinity", label: "Product affinity", enabled: file?.shape === "orders" },
    { key: "custom", label: "Custom", enabled: true },
  ];

  return (
    <div data-tour="segment-wizard" className="flex max-w-2xl flex-col gap-3">
      <StepCard
        n={1}
        title="Input file"
        active={step === 1}
        reached={reached >= 1 && !!file}
        summary={file ? `${file.name} · ${file.shape === "orders" ? "Orders" : "Customers"} export · ${file.rows.length.toLocaleString()} rows` : undefined}
        onEdit={() => setStep(1)}
      >
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center hover:border-accent">
          <Upload size={18} className="text-zinc-500" />
          <span className="text-sm text-zinc-300">Upload a Shopify Orders or Customers export (.csv)</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
        </label>
        {fileError && <p className="mt-2 text-xs text-status-bad">{fileError}</p>}
      </StepCard>

      <StepCard
        n={2}
        title="Segment"
        active={step === 2}
        reached={reached >= 3}
        summary={`${kinds.find((k) => k.key === kind)?.label} · ${count(segment.length, "customer")}`}
        onEdit={() => setStep(2)}
      >
        <div className="mb-4 flex w-fit gap-1 rounded-full bg-zinc-900 p-1">
          {kinds.map((k) => (
            <button
              key={k.key}
              disabled={!k.enabled}
              onClick={() => setKind(k.key)}
              title={k.enabled ? undefined : "Needs an Orders export"}
              className={`rounded-full px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                kind === k.key ? "bg-zinc-700 text-zinc-50" : "text-zinc-400"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        {kind === "rfm" && (
          <div className="flex flex-col gap-3">
            <Select value={tier} onChange={(v) => setTier(v as RfmTier)} className="w-fit">
              {(Object.keys(RFM_TIER_LABELS) as RfmTier[]).map((t) => (
                <option key={t} value={t}>{RFM_TIER_LABELS[t]}</option>
              ))}
            </Select>
            <div className="flex flex-wrap items-end gap-4 text-xs text-zinc-400">
              {(tier === "vip") && (
                <label>
                  Orders at least
                  <input type="number" min={1} value={params.vipOrders} onChange={(e) => setParams({ ...params, vipOrders: Number(e.target.value) })} className={`mt-1 block ${numberInput}`} />
                </label>
              )}
              {(tier === "vip" || tier === "new" || tier === "at_risk") && (
                <label>
                  {tier === "at_risk" ? "Quiet for more than (days)" : "Ordered within (days)"}
                  <input type="number" min={1} value={params.recentDays} onChange={(e) => setParams({ ...params, recentDays: Number(e.target.value) })} className={`mt-1 block ${numberInput}`} />
                </label>
              )}
              {(tier === "at_risk" || tier === "lapsed") && (
                <label>
                  {tier === "at_risk" ? "But not longer than (days)" : "No order for more than (days)"}
                  <input type="number" min={1} value={params.lapsedDays} onChange={(e) => setParams({ ...params, lapsedDays: Number(e.target.value) })} className={`mt-1 block ${numberInput}`} />
                </label>
              )}
              {tier === "big_spenders" && (
                <label>
                  Total spent at least
                  <input type="number" min={0} value={params.minSpend} onChange={(e) => setParams({ ...params, minSpend: Number(e.target.value) })} className={`mt-1 block ${numberInput}`} />
                </label>
              )}
            </div>
          </div>
        )}

        {kind === "affinity" && (
          <div className="flex flex-col gap-4">
            <Select value={mode} onChange={(v) => setMode(v as AffinityMode)} className="w-fit">
              {(Object.keys(AFFINITY_MODE_LABELS) as AffinityMode[]).map((m) => (
                <option key={m} value={m}>{AFFINITY_MODE_LABELS[m]}</option>
              ))}
            </Select>
            <ProductPicker label="Products" options={products} selected={include} onChange={setInclude} />
            {mode === "bought_not" && <ProductPicker label="Excluding" options={products} selected={exclude} onChange={setExclude} />}
          </div>
        )}

        {kind === "custom" && <ConditionBuilder fields={fields} conditions={conditions} onChange={setConditions} />}

        <div className="mt-5 flex items-center gap-4">
          <button onClick={() => goTo(3)} disabled={segment.length === 0} className={primaryButton}>
            Continue
          </button>
          <button
            onClick={downloadList}
            disabled={segment.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-accent hover:text-accent disabled:opacity-40"
          >
            <Download size={14} />
            Download list
          </button>
          <span className="text-sm text-zinc-400">
            <span className="font-medium tabular-nums text-zinc-100">{count(segment.length, "customer")}</span> {segment.length === 1 ? "matches" : "match"}
          </span>
        </div>
      </StepCard>

      <StepCard
        n={3}
        title="Output template"
        active={step === 3}
        reached={reached >= 4}
        summary={template ? `${template.name} · ${template.headers.length} columns` : undefined}
        onEdit={() => setStep(3)}
      >
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center hover:border-accent">
          <Upload size={18} className="text-zinc-500" />
          <span className="text-sm text-zinc-300">{template ? `${template.name} — upload a different template` : "Upload a CSV with the columns you want back"}</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => handleTemplate(e.target.files?.[0])} />
        </label>
        {templateError && <p className="mt-2 text-xs text-status-bad">{templateError}</p>}

        {template && (
          <div className="mt-4 flex flex-col gap-2">
            {template.headers.map((h, i) => (
              <div key={`${h}-${i}`} className="flex items-center gap-3">
                <span className="w-44 shrink-0 truncate text-sm text-zinc-300" title={h}>{h}</span>
                <span className="text-zinc-600">→</span>
                <Select value={mapping[i] ?? ""} onChange={(v) => setMapping((m) => m.map((x, j) => (j === i ? (v as OutputField | "") : x)))}>
                  <option value="">Leave blank</option>
                  {OUTPUT_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        )}

        <button onClick={() => goTo(4)} disabled={!template} className={`mt-5 ${primaryButton}`}>
          Continue
        </button>
      </StepCard>

      <StepCard n={4} title="Download" active={step === 4} reached={false} onEdit={() => setStep(4)}>
        {output && (
          <>
            <p className="text-sm text-zinc-300">
              <span className="font-medium tabular-nums text-zinc-50">{count(output.exported, "row")}</span> ready
              {(output.skippedNoPhone > 0 || output.skippedInvalidPhone > 0) && (
                <span className="text-zinc-500">
                  {" "}· left out: {output.skippedNoPhone} with no phone, {output.skippedInvalidPhone} with an invalid phone
                </span>
              )}
            </p>

            <div className="mt-3 overflow-x-auto scrollbar-thin rounded-lg border border-zinc-900">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-300">
                    {template!.headers.map((h, i) => (
                      <th key={i} className="whitespace-nowrap px-2.5 py-1.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {output.rows.slice(0, 5).map((r, ri) => (
                    <tr key={ri} className="border-b border-zinc-900 text-zinc-400">
                      {r.map((cell, ci) => (
                        <td key={ci} className="whitespace-nowrap px-2.5 py-1.5">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button onClick={download} disabled={output.exported === 0} className={`mt-4 inline-flex items-center gap-2 ${primaryButton}`}>
              <Download size={14} />
              Download CSV
            </button>
          </>
        )}
      </StepCard>
    </div>
  );
}
