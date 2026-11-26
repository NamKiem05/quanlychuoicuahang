import assert from "node:assert/strict";
import { test } from "node:test";
import { createDraftSave } from "../src/lib/theme-draft-save.ts";
import { readThemePages } from "../src/lib/theme-pages.ts";
import { maxThemeImageBytes, themeStudioImageType } from "../src/lib/theme-studio-image.ts";

test("an in-flight save acknowledges only its snapshot and queues the latest revision", async () => {
  const draft = createDraftSave("initial", 4);
  let acknowledge;
  const pending = draft.save("first", revision => {
    assert.equal(revision, 4);
    return new Promise(resolve => { acknowledge = resolve; });
  });
  assert.equal(await draft.save("second", () => assert.fail("parallel write")), "saving");
  acknowledge({ revision: 5 });
  assert.equal(await pending, "saved");
  assert.equal(draft.dirty("second"), true);
  assert.equal(await draft.save("second", async revision => {
    assert.equal(revision, 5);
    return { revision: 6 };
  }), "saved");
  assert.equal(draft.dirty("second"), false);
  assert.equal(draft.dirty("initial"), true);
});

test("network errors preserve dirty state and conflicts stop writes until reload", async () => {
  const draft = createDraftSave("initial", 4);
  assert.equal(await draft.save("updated", async () => { throw new Error("offline"); }), "unavailable");
  assert.equal(draft.dirty("updated"), true);
  assert.equal(draft.revision(), 4);
  assert.equal(await draft.save("updated", async () => ({ error: "conflict" })), "conflict");
  assert.equal(await draft.save("new", () => assert.fail("conflicts may not overwrite")), "conflict");
  assert.equal(draft.dirty("updated"), true);
});

test("only supported raster uploads within the size limit are recognized", () => {
  assert.equal(themeStudioImageType(Uint8Array.from([255,216,255,0,255,217]))?.mime, "image/jpeg");
  assert.equal(themeStudioImageType(new TextEncoder().encode("<svg onload='example()' />")), null);
  assert.equal(themeStudioImageType(new Uint8Array(maxThemeImageBytes + 1)), null);
  assert.equal(themeStudioImageType(Uint8Array.from([255,216,255,0,0])), null);
});

test("structured pages allow platform image object keys only on announcement blocks", () => {
  const id = "81000000-0000-4000-8000-000000000001";
  const blockId = "81000000-0000-4000-8000-000000000002";
  const page = { id, kind: "home", slug: "home", title: "", description: "", visible: true };
  const block = { id: blockId, kind: "announcement", title: "", copy: "", limit: 6, hidden: false };
  const image = `theme-studio/${id}/${blockId}.webp`;
  assert.ok(readThemePages([{ ...page, blocks: [block] }]));
  assert.ok(readThemePages([{ ...page, blocks: [{ ...block, image }] }]));
  assert.equal(readThemePages([{ ...page, blocks: [{ ...block, image: "https://shop.invalid/image.png" }] }]), null);
  assert.equal(readThemePages([{ ...page, blocks: [{ ...block, image, kind: "contact" }] }]), null);
});
