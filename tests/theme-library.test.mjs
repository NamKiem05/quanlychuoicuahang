import assert from "node:assert/strict";
import { test } from "node:test";
import { themeImageUrl, themeLibraryFilters } from "../src/lib/theme-library.ts";

const creator = "98000000-0000-4000-8000-000000000001";
const parse = query => themeLibraryFilters(query, { general: "Tổng hợp" }, /^[a-f0-9-]{36}$/i);

test("library filters preserve literal search and combine independently", () => {
  const result = parse({
    q: "  Thời trang 100% _  ", family: "general", status: "published", distribution: "hidden",
    creator, category: "Bộ sưu tập", dateField: "updated", from: "2024-02-29", to: "2024-02-29",
    order: "installations", page: "3",
  });
  assert.deepEqual(result, {
    q: "Thời trang 100% _", family: "general", status: "published", distribution: "hidden", creator,
    category: "Bộ sưu tập", dateField: "updated", from: "2024-02-29", to: "2024-02-29", order: "installations", page: 3, valid: true,
  });
});

test("library filters reject malformed ranges and normalize unsupported query options", () => {
  const result = parse({ status: "suspended", distribution: "constructor", family: "toString", order: ["oldest"], creator: "bad", from: "2026-02-29", page: "99999" });
  assert.equal(result.valid, false);
  assert.deepEqual([result.status, result.distribution, result.family, result.creator, result.order, result.page], ["", "", "", "", "newest", 1]);
  assert.equal(parse({ from: "2026-11-26", to: "2026-11-25" }).valid, false);
  assert.equal(parse({ to: "2026-11-25" }).valid, true);
});

test("catalog images accept uncredentialed HTTPS URLs and reject malformed or unsafe references", () => {
  assert.equal(themeImageUrl(""), true);
  assert.equal(themeImageUrl("https://example.invalid/cover.webp"), true);
  for (const invalid of [
    "http://example.invalid/cover", "https://", "https://a:b@example.invalid/cover",
    "https://example.invalid/a b", "https://example.invalid\\image", "data:image/png,abc",
    "https://example.invalid/" + "x".repeat(2048),
  ]) assert.equal(themeImageUrl(invalid), false, invalid);
});
