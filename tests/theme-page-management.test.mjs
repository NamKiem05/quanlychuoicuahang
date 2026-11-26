import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { findThemeHome, readThemePages, resolveThemePage, themePageInNavigation } from "../src/lib/theme-pages.ts";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "./theme-pages" ? "./theme-pages.ts" : specifier, context);
  },
});
const { changeThemePages } = await import("../src/lib/theme-page-management.ts");
hooks.deregister();

const uid = n => `81000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const root = { id: uid(1), kind: "home", slug: "home", title: "Home", description: "", visible: true, blocks: [] };
const base = { kind: "custom", slug: "cau-hoi", title: "Câu hỏi", description: "", visible: true, meta: { template: "faq", navigation: true, seoTitle: "FAQ test" } };
const now = "2026-11-25T08:00:00.000Z";
let seq = 100;
const options = { now, id: () => uid(++seq), family: "general", disabled: [], maxCustomPages: 16 };
const apply = (pages, command) => changeThemePages(pages, command, options);

test("create validates slugs, seeds only supported blocks, and keeps the existing home", () => {
  const result = apply([root], { type: "create", id: "", fields: base });
  const item = result.pages[1];
  assert.equal(item.meta.createdAt, now);
  assert.equal(item.blocks[0].kind, "announcement");
  assert.equal(findThemeHome(result.pages).id, root.id);
  assert.match(apply(result.pages, { type: "create", id: "", fields: base }).error, /đã được sử dụng/);
  assert.match(apply([root], { type: "create", id: "", fields: { ...base, slug: "checkout" } }).error, /hệ thống/);
  const hidden = changeThemePages([], { type: "create", id: "", fields: { ...base, visible: false } }, { ...options, disabled: ["announcement"] });
  assert.deepEqual(hidden.pages[0].blocks, []);
  assert.equal(resolveThemePage(hidden.pages, base.slug), undefined);
  const explicit = apply([], { type: "create", id: "", fields: { ...base, kind: "home", slug: "home", meta: {} } });
  assert.equal(resolveThemePage(explicit.pages), undefined);
  assert.equal(resolveThemePage(apply(explicit.pages, { type: "home", id: explicit.selected }).pages).id, explicit.selected);
});

test("metadata edits, slug and template changes preserve blocks and validate ownership", () => {
  const created = apply([root], { type: "create", id: "", fields: base });
  const old = created.pages[1];
  assert.match(apply([root], { type: "edit", id: old.id, fields: base }).error, /không thuộc/);
  const result = apply(created.pages, { type: "edit", id: old.id, fields: {
    ...base, slug: "chinh-sach", meta: { template: "policy", navigation: false, noindex: true, seoTitle: "Chính sách", ogImage: "https://example.invalid/page.webp" },
  } });
  assert.deepEqual(result.pages[1].blocks, old.blocks);
  assert.equal(result.pages[1].meta.template, "policy");
  assert.equal(themePageInNavigation(result.pages[1]), false);
  assert.equal(resolveThemePage(result.pages, "chinh-sach").id, old.id);
  assert.equal(resolveThemePage(result.pages, old.slug), undefined);
});

test("homepage stays unique, protected system routes survive, and duplicates have fresh IDs", () => {
  const created = apply([root], { type: "create", id: "", fields: base });
  const original = created.pages[1];
  const home = apply(created.pages, { type: "home", id: original.id });
  assert.equal(resolveThemePage(home.pages).id, original.id);
  assert.match(apply(home.pages, { type: "delete", id: original.id }).error, /thay thế/);
  assert.match(apply(home.pages, { type: "toggle", id: original.id }).error, /thay thế/);
  assert.match(apply(home.pages, { type: "delete", id: root.id }).error, /hệ thống/);
  const duplicated = apply(home.pages, { type: "copy", id: original.id });
  const clone = duplicated.pages[2];
  assert.notEqual(clone.id, original.id);
  assert.notEqual(clone.slug, original.slug);
  assert.notEqual(clone.blocks[0].id, original.blocks[0].id);
  assert.equal(clone.meta.seoTitle, original.meta.seoTitle);
  assert.equal(clone.meta.homepage, false);
  assert.equal(clone.visible, false);
  const replacement = apply(duplicated.pages, { type: "home", id: root.id });
  assert.equal(resolveThemePage(replacement.pages).id, root.id);
  assert.equal(apply(replacement.pages, { type: "delete", id: original.id }).pages.length, 2);
  assert.equal(readThemePages([root, { ...original, visible: false, meta: { homepage: true } }]), null);
  assert.equal(readThemePages([{ ...root, meta: { homepage: true } }, { ...original, meta: { homepage: true } }]), null);
});
