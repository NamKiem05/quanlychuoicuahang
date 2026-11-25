import assert from "node:assert/strict";
import { test } from "node:test";
import { readLimitedJson } from "../src/lib/http/read-limited-json.ts";

function request(body, contentLength) {
  const headers = { "content-type": "application/json" };
  if (contentLength !== undefined) headers["content-length"] = String(contentLength);
  return new Request("https://example.test/api/shipping/ghn-quote", { method: "POST", headers, body });
}

test("bounded JSON reader accepts a valid body when Content-Length is absent", async () => {
  assert.deepEqual(await readLimitedJson(request('{"ok":true}'), 16), { ok: true });
});

test("bounded JSON reader enforces streamed bytes when Content-Length understates the body", async () => {
  await assert.rejects(readLimitedJson(request('{"payload":"123456789"}', 1), 16), /BODY_TOO_LARGE/);
});

test("bounded JSON reader rejects a declared Content-Length above the limit", async () => {
  await assert.rejects(readLimitedJson(request('{"ok":true}', 100), 16), /BODY_TOO_LARGE/);
});

test("bounded JSON reader accepts an exactly sized stream and rejects oversized streams without a length", async () => {
  assert.deepEqual(await readLimitedJson(request('{"a":1}  '), 9), { a: 1 });
  await assert.rejects(readLimitedJson(request('{"a":1}   '), 9), /BODY_TOO_LARGE/);
});
