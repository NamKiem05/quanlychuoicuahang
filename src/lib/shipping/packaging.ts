export const dimensionFields = [
  ["weight_g", "Cân nặng (g)", 19999],
  ["length_cm", "Chiều dài (cm)", 200],
  ["width_cm", "Chiều rộng (cm)", 200],
  ["height_cm", "Chiều cao (cm)", 200],
] as const;

export type Dimensions = Record<(typeof dimensionFields)[number][0], number>;
export type ProductDimensions = Dimensions & { stackable?: boolean };
export type Packaging = Dimensions & { kind: "box" | "bag"; packing_rule: "single" | "stack" };
export type PackagingProfile = Packaging & { id: string; name: string };
export type GhnCheckoutSnapshot = {
  provider?: "ghn";
  environment?: "staging";
  packaging_id?: string;
  packaging_name?: string;
  eta?: string | null;
  service_type_id?: number;
  shop_id: number;
  province: string;
  ward: string;
  weight: number;
  length: number;
  width: number;
  height: number;
};

export function hasSignificantParcelChange(
  expected: Pick<GhnCheckoutSnapshot, "weight" | "length" | "width" | "height">,
  actual: Pick<GhnCheckoutSnapshot, "weight" | "length" | "width" | "height">,
) {
  const fields = ["weight", "length", "width", "height"] as const;
  return fields.some((field) => {
    const before = expected[field], after = actual[field];
    if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0 || after <= 0) return true;
    const delta = Math.abs(after - before);
    // Either threshold is enough to require confirmation. Requiring both hid meaningful changes.
    return delta >= (field === "weight" ? 100 : 2) || delta * 5 >= before;
  });
}

export function readDimensions(form: FormData, packaging = false): ProductDimensions | null | false {
  const input: Record<string, unknown> = Object.fromEntries(dimensionFields.map(([key]) => [key, form.get(key)]));
  if (!packaging) input.stackable = form.get("stackable") === "on";
  return parseDimensions(input, packaging);
}

export function parseDimensions(input: unknown, packaging = false): ProductDimensions | null | false {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return false;
  const fields = input as Record<string, unknown>;
  const values = dimensionFields.map(([key]) => {
    const value = fields[key];
    return value == null ? "" : typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : "!invalid!";
  });
  if (values.every((value) => !value)) return null;
  if (!packaging && fields.stackable !== undefined && typeof fields.stackable !== "boolean") return false;

  const numbers = values.map(Number);
  if (values.some((value, index) => !/^\d+$/.test(value) || !Number.isSafeInteger(numbers[index]) ||
    numbers[index] < (packaging && index === 0 ? 0 : 1) ||
    numbers[index] > dimensionFields[index][2] - (packaging && index === 0 ? 1 : 0))) return false;

  const [weight_g, length_cm, width_cm, height_cm] = numbers;
  return packaging
    ? { weight_g, length_cm, width_cm, height_cm }
    : { weight_g, length_cm, width_cm, height_cm, stackable: fields.stackable === true };
}

/** Strict parser for values read from Supabase JSON columns. Form strings are not accepted here. */
export function parseStoredDimensions(input: unknown): ProductDimensions | null | false {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return input == null ? null : false;
  const fields = input as Record<string, unknown>;
  if (dimensionFields.some(([key]) => typeof fields[key] !== "number") ||
      (fields.stackable !== undefined && typeof fields.stackable !== "boolean")) return false;
  return parseDimensions(fields);
}

export type ParcelItem = { dimensions: ProductDimensions; quantity: number };
const isIntBetween = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

function validPackaging(profile: unknown): profile is PackagingProfile {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
  const p = profile as Record<string, unknown>;
  return typeof p.id === "string" && p.id.length > 0 && typeof p.name === "string" && p.name.length > 0 &&
    (p.kind === "box" || p.kind === "bag") && (p.packing_rule === "single" || p.packing_rule === "stack") &&
    isIntBetween(p.weight_g, 0, 19998) && isIntBetween(p.length_cm, 1, 200) &&
    isIntBetween(p.width_cm, 1, 200) && isIntBetween(p.height_cm, 1, 200);
}

function validItem(item: unknown): item is ParcelItem {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const value = item as Record<string, unknown>;
  const d = value.dimensions;
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  const parsed = parseStoredDimensions(d);
  return parsed !== null && parsed !== false && isIntBetween(value.quantity, 1, 20);
}

function fitsBase(dimensions: Dimensions, length: number, width: number) {
  return (dimensions.length_cm <= length && dimensions.width_cm <= width) ||
    (dimensions.width_cm <= length && dimensions.length_cm <= width);
}

function commonBase(items: ParcelItem[]) {
  const first = items[0].dimensions;
  return items.every(({ dimensions }) =>
    (dimensions.length_cm === first.length_cm && dimensions.width_cm === first.width_cm) ||
    (dimensions.length_cm === first.width_cm && dimensions.width_cm === first.length_cm));
}

export function packItems(packaging: Packaging, items: ParcelItem[]) {
  if (!validPackaging({ ...packaging, id: "internal", name: "internal" }) ||
      !Array.isArray(items) || items.length === 0 || !items.every(validItem)) return null;
  let weight = packaging.weight_g;
  let height = 0;
  let units = 0;
  for (const { dimensions, quantity } of items) {
    if (!fitsBase(dimensions, packaging.length_cm, packaging.width_cm)) return null;
    weight += dimensions.weight_g * quantity;
    height += dimensions.height_cm * quantity;
    units += quantity;
  }
  if (!Number.isSafeInteger(weight) || weight > 19999 || height > packaging.height_cm ||
      (packaging.packing_rule === "single" && units !== 1) ||
      (units > 1 && (packaging.packing_rule !== "stack" || items.some((item) => item.dimensions.stackable !== true) || !commonBase(items)))) return null;

  return { weight, length: packaging.length_cm, width: packaging.width_cm, height: packaging.height_cm };
}

export function choosePackaging(profiles: unknown, items: unknown) {
  if (!Array.isArray(profiles) || !Array.isArray(items) || !items.every(validItem)) return null;
  const validProfiles = profiles.filter(validPackaging);
  const volume = (p: PackagingProfile) => p.length_cm * p.width_cm * p.height_cm;
  const candidates = [...validProfiles].sort((a, b) =>
    volume(a) - volume(b) || a.weight_g - b.weight_g || a.id.localeCompare(b.id));
  for (const profile of candidates) {
    const parcel = packItems(profile, items);
    if (parcel) return { profile, parcel };
  }
  return null;
}

export function parseGhnCheckoutSnapshot(value: unknown): GhnCheckoutSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (!Number.isSafeInteger(snapshot.shop_id) || Number(snapshot.shop_id) < 1 ||
      typeof snapshot.province !== "string" || !snapshot.province || typeof snapshot.ward !== "string" || !snapshot.ward ||
      !isIntBetween(snapshot.weight, 1, 19999) || !isIntBetween(snapshot.length, 1, 200) ||
      !isIntBetween(snapshot.width, 1, 200) || !isIntBetween(snapshot.height, 1, 200)) return null;
  if (snapshot.eta !== undefined && snapshot.eta !== null && (typeof snapshot.eta !== "string" || !Number.isFinite(Date.parse(snapshot.eta)))) return null;
  if (snapshot.packaging_id !== undefined && typeof snapshot.packaging_id !== "string") return null;
  if (snapshot.packaging_name !== undefined && typeof snapshot.packaging_name !== "string") return null;
  return snapshot as GhnCheckoutSnapshot;
}
