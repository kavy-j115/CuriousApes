"use client";
import Select from "../_components/Select";
import MultiSelect from "../_components/MultiSelect";

export type FieldType = "number" | "date" | "text";
export type FieldDef = { key: string; label: string; type: FieldType };
export type Operator = "gte" | "lte" | "eq" | "contains" | "not_contains";
export type Condition = { field: string; operator: Operator; value: string };

const OPERATORS_BY_TYPE: Record<FieldType, { value: Operator; label: string }[]> = {
  number: [
    { value: "gte", label: "is at least" },
    { value: "lte", label: "is at most" },
    { value: "eq", label: "is exactly" },
  ],
  date: [
    { value: "gte", label: "on or after" },
    { value: "lte", label: "on or before" },
    { value: "eq", label: "is exactly" },
  ],
  text: [
    { value: "contains", label: "contains" },
    { value: "not_contains", label: "does not contain" },
    { value: "eq", label: "is exactly" },
  ],
};

const inputClass =
  "rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-accent focus:outline-none";

// Lets someone build their own "field [is at least] [value]" filters
// instead of being limited to whatever fixed filters we thought to add --
// used by both the internal-data customer search and the upload path's
// Custom recipe, so picking a condition always works the same way
// regardless of where the data comes from.
export default function ConditionBuilder({
  fields,
  conditions,
  onChange,
}: {
  fields: FieldDef[];
  conditions: Condition[];
  onChange: (next: Condition[]) => void;
}) {
  function fieldType(key: string): FieldType {
    return fields.find((f) => f.key === key)?.type ?? "text";
  }

  function update(i: number, patch: Partial<Condition>) {
    const next = conditions.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }

  function add() {
    const first = fields[0];
    if (!first) return;
    onChange([...conditions, { field: first.key, operator: OPERATORS_BY_TYPE[first.type][0].value, value: "" }]);
  }

  function remove(i: number) {
    onChange(conditions.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-col gap-2">
      {conditions.map((c, i) => {
        const type = fieldType(c.field);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            {/* Searchable, scrolling list (many fields) instead of a plain select. */}
            <MultiSelect
              single
              placeholder="Choose a field"
              options={fields.map((f) => ({ id: f.key, label: f.label }))}
              selected={c.field ? [c.field] : []}
              onChange={(ids) => {
                const v = ids[0];
                if (v) update(i, { field: v, operator: OPERATORS_BY_TYPE[fieldType(v)][0].value });
              }}
            />
            <Select value={c.operator} onChange={(v) => update(i, { operator: v as Operator })}>
              {OPERATORS_BY_TYPE[type].map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </Select>
            <input
              type={type === "date" ? "date" : type === "number" ? "number" : "text"}
              value={c.value}
              onChange={(e) => update(i, { value: e.target.value })}
              className={inputClass}
            />
            <button onClick={() => remove(i)} className="text-xs text-zinc-500 hover:text-status-bad">
              remove
            </button>
          </div>
        );
      })}
      <button onClick={add} className="self-start text-sm text-accent hover:underline">
        + Add condition
      </button>
    </div>
  );
}
