import assert from "node:assert/strict";
import { test } from "node:test";
import { blockCompatible, readThemePages } from "../src/lib/theme-pages.ts";

const pageId = "81000000-0000-4000-8000-000000000001";
const blockId = "81000000-0000-4000-8000-000000000002";
const page = {
  id: pageId, kind: "custom", slug: "bao-hanh", title: "Bảo hành",
  description: "Thông tin bảo hành", visible: true,
  blocks: [{ id: blockId, kind: "announcement", title: "Lưu ý", copy: "Giữ chứng từ", limit: 6, hidden: false }],
};

test("accepts a structured page and preserves stable component IDs", () => {
  assert.deepEqual(readThemePages([page]), [page]);
  assert.deepEqual(readThemePages([]), []);
});
test("rejects duplicate IDs, slugs and reserved routes", () => {
  assert.equal(readThemePages([page, page]), null);
  assert.equal(readThemePages([{ ...page, slug: "checkout/pay" }]), null);
  assert.equal(readThemePages([{ ...page, slug: "cart" }]), null);
  assert.equal(readThemePages([{ ...page, blocks: [{ ...page.blocks[0], id: pageId }] }]), null);
});
test("protects system page visibility and rejects unregistered code", () => {
  assert.equal(readThemePages([{ ...page, kind: "cart", slug: "cart", visible: false }]), null);
  assert.equal(readThemePages([{ ...page, blocks: [{ ...page.blocks[0], kind: "script" }] }]), null);
  assert.equal(readThemePages([{ ...page, blocks: [{ ...page.blocks[0], limit: 90 }] }]), null);
});
test("filters industry components separately from shared components", () => {
  assert.equal(blockCompatible("food_menu", "fashion"), false);
  assert.equal(blockCompatible("food_menu", "food"), true);
  assert.equal(blockCompatible("new_arrivals", "fashion"), true);
});
