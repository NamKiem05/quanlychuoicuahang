import assert from "node:assert/strict";
import { test } from "node:test";
import { choosePackaging, hasSignificantParcelChange, packItems, parseDimensions, parseStoredDimensions } from "../src/lib/shipping/packaging.ts";
const product = (overrides = {}) => ({ weight_g: 100, length_cm: 10, width_cm: 8, height_cm: 5, ...overrides });
const box = (overrides = {}) => ({ id: "box-a", name: "Hộp", kind: "box", packing_rule: "single", weight_g: 50, length_cm: 12, width_cm: 10, height_cm: 8, ...overrides });
const item = (dimensions = product(), quantity = 1) => ({ dimensions, quantity });

test("one product fits one suitable package and includes the empty package weight", () => {
  assert.deepEqual(packItems(box(), [item()]), { weight: 150, length: 12, width: 10, height: 8 });
});
test("rejects a product that cannot fit the package base", () => {
  assert.equal(packItems(box(), [item(product({ length_cm: 13, width_cm: 11 }))]), null);
});
test("rejects a product that exceeds package height", () => {
  assert.equal(packItems(box(), [item(product({ height_cm: 9 }))]), null);
});
test("single packing rule accepts only one physical unit", () => {
  assert.equal(packItems(box(), [item(product(), 2)]), null);
});
test("stack packing requires an explicit stackable flag and a common base", () => {
  const stack = box({ packing_rule: "stack", height_cm: 12 });
  assert.equal(packItems(stack, [item(product(), 2)]), null);
  assert.equal(packItems(stack, [item(product({ stackable: true }), 2)])?.height, 12);
});
test("quantity multiplies product weight and height", () => {
  const result = packItems(box({ packing_rule: "stack", height_cm: 12 }), [item(product({ stackable: true }), 2)]);
  assert.equal(result?.weight, 250);
});
test("package weight plus product weight may equal the configured parcel maximum", () => {
  assert.equal(packItems(box({ weight_g: 0 }), [item(product({ weight_g: 19999 }))])?.weight, 19999);
});
test("rejects total weight above the configured parcel maximum", () => {
  assert.equal(packItems(box({ weight_g: 1 }), [item(product({ weight_g: 19999 }))]), null);
});
test("rejects zero and negative dimensions", () => {
  assert.equal(parseDimensions({ ...product(), width_cm: 0 }), false);
  assert.equal(parseDimensions({ ...product(), weight_g: -1 }), false);
});
test("rejects fractional dimensions", () => {
  assert.equal(parseDimensions({ ...product(), height_cm: 1.5 }), false);
});
test("rejects NaN and Infinity", () => {
  assert.equal(parseDimensions({ ...product(), height_cm: Number.NaN }), false);
  assert.equal(parseDimensions({ ...product(), height_cm: Number.POSITIVE_INFINITY }), false);
});
test("rejects incomplete dimensions and treats fully blank input as unset", () => {
  assert.equal(parseDimensions({ weight_g: 100 }), false);
  assert.equal(parseDimensions({}), null);
});
test("database dimensions require numeric fields and a boolean stackable value", () => {
  assert.equal(parseStoredDimensions({ ...product(), weight_g: "100" }), false);
  assert.equal(parseStoredDimensions({ ...product(), stackable: "on" }), false);
  assert.equal(parseStoredDimensions(product())?.stackable, false);
  assert.equal(parseStoredDimensions(product({ stackable: true }))?.stackable, true);
});
test("chooses the smallest usable profile and ignores malformed profiles", () => {
  const result = choosePackaging([box({ id: "large", length_cm: 30, width_cm: 30, height_cm: 30 }), { ...box(), weight_g: "bad" }, box()], [item()]);
  assert.equal(result?.profile.id, "box-a");
});
test("accepts 90-degree base rotation when the product fits", () => {
  const result = packItems(box(), [item(product({ length_cm: 10, width_cm: 12 }))]);
  assert.ok(result);
});
test("stack packing rejects units without identical base dimensions, even if each fits", () => {
  const result = packItems(box({ packing_rule: "stack", height_cm: 20 }), [
    item(product({ stackable: true, length_cm: 10, width_cm: 8 })),
    item(product({ stackable: true, length_cm: 10, width_cm: 7 })),
  ]);
  assert.equal(result, null);
});
test("stack accepts rotated common bases, different heights, and quantities only while summed limits fit", () => {
  const stack = box({ packing_rule: "stack", height_cm: 10, weight_g: 100 });
  const parcelItems = [
    item(product({ weight_g: 3000, length_cm: 10, width_cm: 8, height_cm: 3, stackable: true }), 2),
    item(product({ weight_g: 4000, length_cm: 8, width_cm: 10, height_cm: 4, stackable: true }), 1),
  ];
  assert.equal(packItems(stack, parcelItems)?.weight, 10100);
  assert.equal(packItems(stack, parcelItems)?.height, 10);
  assert.equal(packItems({ ...stack, height_cm: 9 }, parcelItems), null);
  assert.equal(packItems({ ...stack, weight_g: 10000 }, parcelItems), null);
});
test("parcel change confirmation is triggered by either absolute or relative drift", () => {
  const expected = { weight: 200, length: 5, width: 10, height: 10 };
  assert.equal(hasSignificantParcelChange(expected, { ...expected, weight: 250 }), true); // 25% drift below 100g
  assert.equal(hasSignificantParcelChange({ ...expected, weight: 1000 }, { ...expected, weight: 1100 }), true); // 100g absolute drift
  assert.equal(hasSignificantParcelChange(expected, { ...expected, length: 6 }), true); // 20% drift below 2cm
  assert.equal(hasSignificantParcelChange({ ...expected, length: 30 }, { ...expected, length: 32 }), true); // 2cm absolute drift
  assert.equal(hasSignificantParcelChange({ ...expected, weight: 1000 }, { ...expected, weight: 1050 }), false); // small drift
});
