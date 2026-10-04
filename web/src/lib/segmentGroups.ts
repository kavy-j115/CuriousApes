import {
  affinityRecipe,
  customRecipe,
  DEFAULT_RFM_PARAMS,
  rfmRecipe,
  type AffinityMode,
  type ConditionOperator,
  type ExportRow,
  type ExportShape,
  type OrderProfile,
  type RfmParams,
  type RfmTier,
  type SegmentCustomer,
} from "./segmentRecipes";

// A segment is built from GROUPS. Each group is one rule (an RFM tier, a product
// affinity, or custom conditions). The segment is everyone who matches ANY include
// group, minus everyone who matches ANY exclude group. With no include groups it
// starts from every customer, so "Exclude" alone also works.

export type GroupKind = "rfm" | "affinity" | "custom";
export type GroupCondition = { field: string; operator: ConditionOperator; value: string };

export type SegmentGroup = {
  id: string;
  kind: GroupKind;
  tier: RfmTier;
  params: RfmParams;
  mode: AffinityMode;
  products: string[];
  excludeProducts: string[];
  conditions: GroupCondition[];
};

export type SegmentDefinition = { include: SegmentGroup[]; exclude: SegmentGroup[] };

export type SegmentContext = { rows: ExportRow[]; shape: ExportShape; profiles: OrderProfile[] | null };

let nextId = 1;

export function newGroup(kind: GroupKind = "rfm", params: RfmParams = DEFAULT_RFM_PARAMS): SegmentGroup {
  return {
    id: `g${nextId++}`,
    kind,
    tier: "vip",
    params: { ...params },
    mode: "bought_any",
    products: [],
    excludeProducts: [],
    conditions: [],
  };
}

/** Same customer across groups: by email, falling back to name + phone. */
export function customerKey(c: SegmentCustomer): string {
  return (c.email || `${c.firstName} ${c.lastName} ${c.phone}`).trim().toLowerCase();
}

/** A group that isn't filled in yet (no products picked, no condition value) is ignored. */
export function isGroupUsable(g: SegmentGroup): boolean {
  if (g.kind === "rfm") return true;
  if (g.kind === "affinity") return g.products.length > 0;
  return g.conditions.some((c) => c.value.trim() !== "");
}

export function evaluateGroup(g: SegmentGroup, ctx: SegmentContext): SegmentCustomer[] {
  if (g.kind === "custom") {
    const usable = g.conditions.filter((c) => c.value.trim() !== "").map((c) => ({ column: c.field, operator: c.operator, value: c.value }));
    return customRecipe(ctx.rows, usable, ctx.shape);
  }
  if (!ctx.profiles) return [];
  if (g.kind === "rfm") return rfmRecipe(ctx.profiles, g.tier, g.params);
  return affinityRecipe(ctx.profiles, g.mode, g.products, g.excludeProducts);
}

export function evaluateDefinition(def: SegmentDefinition, ctx: SegmentContext): SegmentCustomer[] {
  const includes = def.include.filter(isGroupUsable);
  // Include groups exist but none is filled in yet: nothing matches (rather than everyone).
  if (def.include.length > 0 && includes.length === 0) return [];

  const chosen = new Map<string, SegmentCustomer>();
  if (includes.length === 0) {
    for (const c of customRecipe(ctx.rows, [], ctx.shape)) chosen.set(customerKey(c), c);
  } else {
    for (const g of includes) for (const c of evaluateGroup(g, ctx)) chosen.set(customerKey(c), c);
  }

  const removed = new Set<string>();
  for (const g of def.exclude.filter(isGroupUsable)) for (const c of evaluateGroup(g, ctx)) removed.add(customerKey(c));

  return [...chosen.values()].filter((c) => !removed.has(customerKey(c)));
}
