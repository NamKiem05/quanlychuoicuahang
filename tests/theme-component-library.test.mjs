import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  componentReleases, componentStatus, createThemeBlock, fieldsForComponent, filterThemeComponents, readablePublicThemePages, readThemePages, themeBlocks,
} from "../src/lib/theme-pages.ts";

const uid = n => `81000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const page = { id: uid(1), kind: "home", slug: "home", visible: true, title: "Trang chủ", description: "" };

test("registry contains supported settings and version history without changing legacy storage", () => {
  assert.equal(Object.keys(themeBlocks).length, 11);
  assert.deepEqual(fieldsForComponent("food_menu"), ["title", "copy", "limit", "hidden"]);
  assert.deepEqual(fieldsForComponent("announcement"), ["title", "copy", "image", "hidden"]);
  assert.equal(componentReleases("announcement")[0].version, "1.1.0");
  for (const [index, kind] of Object.keys(themeBlocks).entries()) {
    assert.ok(readThemePages([{ ...page, blocks: [createThemeBlock(kind, uid(index + 10))] }]));
  }
});

test("library filters combine text, source, status and industry while sorting by actual usage", () => {
  const entries = [
    { kind: "food_menu", status: componentStatus("food_menu", ["food_menu"], []), themes: 4 },
    { kind: "fashion_collection", status: "active", themes: 6 },
    { kind: "new_arrivals", status: "active", themes: 3 },
    { kind: "announcement", status: componentStatus("announcement", [], ["announcement"]), themes: 2 },
  ];
  assert.deepEqual(filterThemeComponents(entries, { source: "catalog", family: "food", status: "active" }).map(x => x.kind), ["new_arrivals"]);
  assert.deepEqual(filterThemeComponents(entries, { term: "thực đơn", status: "disabled" }).map(x => x.kind), ["food_menu"]);
  assert.deepEqual(filterThemeComponents(entries, { version: "1.1.0", status: "deprecated" }).map(x => x.kind), ["announcement"]);
  assert.deepEqual(filterThemeComponents(entries, { order: "usage" }).map(x => x.themes), [6, 4, 3, 2]);
  assert.equal(filterThemeComponents(entries, { responsive: "no" }).length, 0);
});

test("public fallback omits invalid components while preserving valid neighbours", () => {
  const good = createThemeBlock("announcement", uid(3));
  const another = createThemeBlock("story", uid(4));
  const broken = [{ ...page, blocks: [{ ...good, kind: "missing_renderer" }, good, { ...another, limit: 900 }, another] }];
  assert.equal(readThemePages(broken), null);
  assert.deepEqual(readablePublicThemePages(broken)[0].blocks, [good, another]);
  assert.deepEqual(readablePublicThemePages([{ ...page, blocks: [good] }])[0].blocks, [good]);
});

test("the storefront renderer retains an existing disabled instance and skips incompatible blocks", async () => {
  const require = createRequire(import.meta.url);
  const nextModules = new Map(["next/link", "next/image"].map(name => [name, pathToFileURL(require.resolve(name)).href]));
  const target = new URL("../src/components/storefront/theme-sections.tsx", import.meta.url);
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@/lib/theme-pages") return nextResolve(new URL("../src/lib/theme-pages.ts", import.meta.url).href, context);
      const next = nextModules.get(specifier);
      if (next) return nextResolve(next, context);
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url !== target.href) return nextLoad(url, context);
      const source = ts.transpileModule(readFileSync(target, "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      return { format: "module", source, shortCircuit: true };
    },
  });
  try {
    const { default: ThemeSections } = await import(target.href);
    const blocks = readablePublicThemePages([{ ...page, blocks: [
      { ...createThemeBlock("announcement", uid(10)), title: "Thông báo còn hoạt động" },
      { ...createThemeBlock("food_menu", uid(11)), title: "Sai ngành" },
      { ...createThemeBlock("story", uid(12)), hidden: true, title: "Nội dung ẩn" },
    ] }]);
    assert.equal(componentStatus("announcement", ["announcement"], []), "disabled");
    const html = renderToStaticMarkup(createElement(ThemeSections, {
      pages: blocks, page: blocks[0], family: "general", base: "/test",
      store: { name: "Store", description: "", address: null, phone: null },
      products: [], categories: [], reviews: [],
    }));
    assert.match(html, /Thông báo còn hoạt động/);
    assert.doesNotMatch(html, /Sai ngành|Nội dung ẩn/);
  } finally {
    hooks.deregister();
  }
});
