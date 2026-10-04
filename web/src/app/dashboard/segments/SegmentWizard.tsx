"use client";

import { useMemo, useState } from "react";
import { Upload, Check, Download } from "lucide-react";
import Select from "../_components/Select";
import GroupBuilder from "./GroupBuilder";
import { CUSTOMER_FRIENDLY_FIELDS, ORDER_FRIENDLY_FIELDS } from "@/lib/segmentFriendlyFields";
import {
  parseExport,
  detectShape,
  buildOrderProfiles,
  distinctProducts,
  suggestMinSpend,
  DEFAULT_RFM_PARAMS,
  parseTemplateHeaders,
  guessField,
  buildOutput,
  buildListCsv,
  OUTPUT_FIELDS,
  type ExportRow,
  type ExportShape,
  type RfmParams,
  type OutputField,
  type SegmentCustomer,
} from "@/lib/segmentRecipes";
import { evaluateDefinition, evaluateGroup, newGroup, type SegmentDefinition } from "@/lib/segmentGroups";

type Loaded = { name: string; shape: ExportShape; rows: ExportRow[] };
type Template = { name: string; headers: string[] };

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

  // The segment is built from include / exclude groups (see lib/segmentGroups.ts).
  const [definition, setDefinition] = useState<SegmentDefinition>({ include: [newGroup("rfm")], exclude: [] });
  const [defaultParams, setDefaultParams] = useState<RfmParams>(DEFAULT_RFM_PARAMS);

  const [template, setTemplate] = useState<Template | null>(null);
  const [mapping, setMapping] = useState<(OutputField | "")[]>([]);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const profiles = useMemo(() => (file?.shape === "orders" ? buildOrderProfiles(file.rows) : null), [file]);
  const products = useMemo(() => (file?.shape === "orders" ? distinctProducts(file.rows) : []), [file]);

  const context = useMemo(() => (file ? { rows: file.rows, shape: file.shape, profiles } : null), [file, profiles]);
  const segment: SegmentCustomer[] = useMemo(() => (context ? evaluateDefinition(definition, context) : []), [context, definition]);
  const includeCounts = useMemo(() => (context ? definition.include.map((g) => evaluateGroup(g, context).length) : []), [context, definition.include]);
  const excludeCounts = useMemo(() => (context ? definition.exclude.map((g) => evaluateGroup(g, context).length) : []), [context, definition.exclude]);

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
    if (shape === "customers") {
      setDefaultParams(DEFAULT_RFM_PARAMS);
      setDefinition({ include: [newGroup("custom")], exclude: [] });
    } else {
      const params = { ...DEFAULT_RFM_PARAMS, minSpend: suggestMinSpend(buildOrderProfiles(rows)) };
      setDefaultParams(params);
      setDefinition({ include: [newGroup("rfm", params)], exclude: [] });
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
    saveCsv(output.csv, "segment.csv");
  }

  // Straight from the segment step: the whole list, no output template needed.
  function downloadList() {
    saveCsv(buildListCsv(segment), "segment_list.csv");
  }

  const fields = file?.shape === "customers" ? CUSTOMER_FRIENDLY_FIELDS : ORDER_FRIENDLY_FIELDS;

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
        summary={`${definition.include.length} include · ${definition.exclude.length} exclude · ${count(segment.length, "customer")}`}
        onEdit={() => setStep(2)}
      >
        {file && (
          <div className="flex flex-col gap-3">
            <GroupBuilder
              mode="include"
              groups={definition.include}
              onChange={(next) => setDefinition((d) => ({ ...d, include: next }))}
              shape={file.shape}
              products={products}
              fields={fields}
              defaultParams={defaultParams}
              counts={includeCounts}
            />
            <GroupBuilder
              mode="exclude"
              groups={definition.exclude}
              onChange={(next) => setDefinition((d) => ({ ...d, exclude: next }))}
              shape={file.shape}
              products={products}
              fields={fields}
              defaultParams={defaultParams}
              counts={excludeCounts}
            />
          </div>
        )}

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
