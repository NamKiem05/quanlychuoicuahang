import assert from "node:assert/strict";
import { test } from "node:test";
import { proposeThemeSlug, validCreationSlug } from "../src/lib/theme-creation.ts";

test("suggests browser and database compatible slugs from Vietnamese names", () => {
  assert.equal(proposeThemeSlug("  Đồ Gia Dụng & Nội Thất  "), "do-gia-dung-noi-that");
  assert.equal(proposeThemeSlug(" — "), "");
  const slug = proposeThemeSlug("a".repeat(79) + " ! more");
  assert.equal(slug.length, 79);
  assert.equal(validCreationSlug(slug), true);
});

test("rejects empty, reserved syntax, uppercase and overlong slugs", () => {
  for (const slug of ["", "UPPER", "-a", "a--b", "a/b", "a ".repeat(40), "a".repeat(81)]) {
    assert.equal(validCreationSlug(slug), false, slug);
  }
  assert.equal(validCreationSlug("fashion-store-2"), true);
});
