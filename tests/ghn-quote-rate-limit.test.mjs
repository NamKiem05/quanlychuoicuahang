import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { consumeGhnQuoteRateLimit, getGhnQuoteIpHash } from "../src/lib/shipping/ghn-quote-rate-limit.ts";

const key = randomBytes(32).toString("base64");
const validRequest = (ip = "203.0.113.8") => new Request("https://example.test", { headers: { "x-vercel-forwarded-for": ip } });

test("IP bucket uses HMAC-SHA256 with the independent rate-limit secret", () => {
  const actual = getGhnQuoteIpHash(validRequest(), key);
  const expected = createHmac("sha256", Buffer.from(key, "base64")).update("203.0.113.8").digest("hex");
  assert.equal(actual, expected);
});

test("missing or reused GHN encryption secret fails closed", () => {
  const rateKey = process.env.GHN_QUOTE_RATE_LIMIT_HMAC_KEY;
  const previous = process.env.GHN_CREDENTIALS_ENCRYPTION_KEY;
  delete process.env.GHN_QUOTE_RATE_LIMIT_HMAC_KEY;
  process.env.GHN_CREDENTIALS_ENCRYPTION_KEY = key;
  try {
    assert.throws(() => getGhnQuoteIpHash(validRequest()), /GHN_RATE_LIMIT_KEY_MISSING/);
    assert.throws(() => getGhnQuoteIpHash(validRequest(), key), /GHN_RATE_LIMIT_KEY_INVALID/);
  }
  finally {
    if (previous === undefined) delete process.env.GHN_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.GHN_CREDENTIALS_ENCRYPTION_KEY = previous;
    if (rateKey !== undefined) process.env.GHN_QUOTE_RATE_LIMIT_HMAC_KEY = rateKey;
  }
});

test("IP bucket accepts only a valid Vercel forwarded IP and ignores other IP headers", () => {
  assert.throws(() => getGhnQuoteIpHash(new Request("https://example.test", {
    headers: { "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.10" },
  }), key), /GHN_RATE_LIMIT_IP_INVALID/);
  assert.throws(() => getGhnQuoteIpHash(validRequest("spoofed, 203.0.113.8"), key), /GHN_RATE_LIMIT_IP_INVALID/);
});

test("RPC errors and malformed results fail closed", async () => {
  const broken = { rpc: async () => ({ data: null, error: { message: "private DB detail" } }) };
  await assert.rejects(consumeGhnQuoteRateLimit(broken, "a".repeat(64), randomUUID()), /GHN_RATE_LIMIT_UNAVAILABLE/);
  const rejected = { rpc: async () => { throw new Error("private network detail"); } };
  await assert.rejects(consumeGhnQuoteRateLimit(rejected, "a".repeat(64), randomUUID()), /GHN_RATE_LIMIT_UNAVAILABLE/);
  const malformed = { rpc: async () => ({ data: [{ allowed: false, retry_after: 0 }], error: null }) };
  await assert.rejects(consumeGhnQuoteRateLimit(malformed, "a".repeat(64), randomUUID()), /GHN_RATE_LIMIT_UNAVAILABLE/);
});

test("RPC limit response preserves the exact Retry-After value", async () => {
  const client = { rpc: async () => ({ data: [{ allowed: false, retry_after: 17 }], error: null }) };
  assert.deepEqual(await consumeGhnQuoteRateLimit(client, "b".repeat(64), randomUUID()), { allowed: false, retryAfter: 17 });
});
