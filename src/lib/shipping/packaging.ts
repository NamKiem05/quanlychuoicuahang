export const dimensionFields = [
  ["weight_g", "Cân nặng (g)", 19999],
  ["length_cm", "Chiều dài (cm)", 200],
  ["width_cm", "Chiều rộng (cm)", 200],
  ["height_cm", "Chiều cao (cm)", 200],
] as const;

export type Dimensions = Record<(typeof dimensionFields)[number][0], number>;
export type Packaging = Dimensions & { kind: "box" | "bag"; packing_rule: "single" | "stack" };
export type GhnCheckoutSnapshot = {
  shop_id: number;
  province: string;
  ward: string;
  weight: number;
  length: number;
  width: number;
  height: number;
};

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

export function packItems(packaging: Packaging, items: { dimensions: Dimensions; quantity: number }[]) {
  let weight = packaging.weight_g;
  let height = 0;
  let units = 0;
  for (const { dimensions, quantity } of items) {
    if (dimensions.length_cm > packaging.length_cm || dimensions.width_cm > packaging.width_cm) return null;
    weight += dimensions.weight_g * quantity;
    height += dimensions.height_cm * quantity;
    units += quantity;
  }
  if (!units || (packaging.packing_rule === "single" && units !== 1) ||
    weight >= 20000 || height > packaging.height_cm) return null;

  return { weight, length: packaging.length_cm, width: packaging.width_cm, height: packaging.height_cm };
}
