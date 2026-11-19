export const dimensionFields = [
  ["weight_g", "Cân nặng (g)", 19999],
  ["length_cm", "Chiều dài (cm)", 200],
  ["width_cm", "Chiều rộng (cm)", 200],
  ["height_cm", "Chiều cao (cm)", 200],
] as const;

export type Dimensions = Record<(typeof dimensionFields)[number][0], number>;
export type Packaging = Dimensions & { kind: "box" | "bag"; packing_rule: "single" | "stack" };
export type PackagingProfile = Packaging & { id: string; name: string };
export type GhnCheckoutSnapshot = {
  packaging_name?: string;
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
    const delta = Math.abs(actual[field] - expected[field]);
    return delta >= (field === "weight" ? 100 : 2) && delta * 5 >= expected[field];
  });
}

export function readDimensions(form: FormData, packaging = false): Dimensions | null | false {
  return parseDimensions(Object.fromEntries(dimensionFields.map(([key]) => [key, form.get(key)])), packaging);
}

export function parseDimensions(input: unknown, packaging = false): Dimensions | null | false {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) return false;
  const fields = input as Record<string, unknown>;
  const values = dimensionFields.map(([key]) => String(fields[key] ?? "").trim());
  if (values.every((value) => !value)) return null;

  const [weight_g, length_cm, width_cm, height_cm] = values.map(Number);
  if (values.some((value, index) => !/^\d+$/.test(value) ||
    Number(value) < (packaging && index === 0 ? 0 : 1) ||
    Number(value) > dimensionFields[index][2] - (packaging && index === 0 ? 1 : 0))) return false;

  return { weight_g, length_cm, width_cm, height_cm };
}

type ParcelItem = { dimensions: Dimensions; quantity: number };

function packItems(packaging: Packaging, items: ParcelItem[]) {
  let weight = packaging.weight_g;
  let height = 0;
  let units = 0;
  for (const { dimensions, quantity } of items) {
    const fitsBase =
      (dimensions.length_cm <= packaging.length_cm && dimensions.width_cm <= packaging.width_cm) ||
      (dimensions.width_cm <= packaging.length_cm && dimensions.length_cm <= packaging.width_cm);
    if (!fitsBase) return null;
    weight += dimensions.weight_g * quantity;
    height += dimensions.height_cm * quantity;
    units += quantity;
  }
  if (!units || (packaging.packing_rule === "single" && units !== 1) ||
    weight >= 20000 || height > packaging.height_cm) return null;

  return { weight, length: packaging.length_cm, width: packaging.width_cm, height: packaging.height_cm };
}

export function choosePackaging(profiles: PackagingProfile[], items: ParcelItem[]) {
  const volume = (p: PackagingProfile) => p.length_cm * p.width_cm * p.height_cm;
  const candidates = [...profiles].sort((a, b) =>
    volume(a) - volume(b) || a.weight_g - b.weight_g || a.id.localeCompare(b.id));
  for (const profile of candidates) {
    const parcel = packItems(profile, items);
    if (parcel) return { profile, parcel };
  }
  return null;
}
