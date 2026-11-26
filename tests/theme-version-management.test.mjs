import assert from "node:assert/strict";
import { test } from "node:test";
import { compareThemeSnapshots, semanticThemeVersion, themeManifestAssetKeys } from "../src/lib/theme-version-management.ts";

const page = (id, slug, blocks = []) => ({ id, kind: "custom", slug, title: slug, description: "", visible: true, blocks });
const block = (id, copy) => ({ id, kind: "announcement", title: "", copy, limit: 6, hidden: false });
const snapshot = (pages, metadata = {}, settings = {}) => ({ metadata, manifest: {
  schemaVersion: 2, preset: "green", style: "modern", order: ["hero", "menu", "reviews", "story"], hidden: [],
  headline: "", density: "comfortable", settings: { font: "system", radius: "soft", width: "standard", columns: [4,3,2], ...settings }, pages,
} });

test("semantic versions reject leading zeros and malformed segments", () => {
  assert.equal(semanticThemeVersion.test("1.0.12"), true);
  for (const version of ["01.0.0", "1.0", "1.2.3-beta", "1.0.1.2", "10000.0.0"]) assert.equal(semanticThemeVersion.test(version), false, version);
});

test("snapshot comparison reports changed routes, settings, component configuration and compatibility", () => {
  const before = snapshot([page("a", "old", [block("x","old copy"), block("y","kept")]), page("b","removed"),page("c","same")],
    { families: ["food","general"] });
  const after = snapshot([page("a","new",[block("x","new copy"),block("z","added")]),page("c","same"),page("e","added")],
    { families: ["general"] }, { radius: "square" });
  const diff = compareThemeSnapshots(before, after);
  assert.ok(diff.some(item => item.area === "Trang" && item.label === "new" && item.warning));
  assert.ok(diff.some(item => item.area === "Trang" && item.state === "removed" && item.label === "removed"));
  assert.ok(diff.some(item => item.area === "Trang" && item.state === "added" && item.label === "added"));
  assert.ok(diff.some(item => item.area === "Trang" && item.state === "unchanged" && item.label === "same"));
  assert.ok(diff.some(item => item.area === "Component" && item.state === "modified" && item.after?.copy === "new copy"));
  assert.ok(diff.some(item => item.area === "Component" && item.state === "removed" && item.warning));
  assert.ok(diff.some(item => item.area === "Thiết kế" && item.state === "modified"));
  assert.ok(diff.some(item => item.area === "Metadata" && item.label === "families" && item.warning));
});

test("technical edit timestamps and JSON property order do not produce false content changes", () => {
  const first = snapshot([{ ...page("a","same"), meta: { seoTitle: "Title", updatedAt: "initial" } }], { config: { y: 1, x: 2 } });
  const second = snapshot([{ ...page("a","same"), meta: { updatedAt: "later", seoTitle: "Title" } }], { config: { x: 2, y: 1 } });
  assert.ok(compareThemeSnapshots(first, second).every(item => item.state === "unchanged"));
  assert.deepEqual(themeManifestAssetKeys(snapshot([page("a","same", [
    { ...block("x",""), image: "asset-a" }, { ...block("y",""), image: "asset-a" }, { ...block("z",""), image: "asset-b" },
  ])]).manifest), ["asset-a", "asset-b"]);
});
