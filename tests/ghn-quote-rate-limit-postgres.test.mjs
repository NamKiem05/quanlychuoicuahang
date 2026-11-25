import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { test } from "node:test";

// Use only a disposable Supabase test project. Test keys are unique and the
// migration's scheduled janitor removes their rows after three minutes.
const url = process.env.GHN_RATE_LIMIT_TEST_SUPABASE_URL;
const serviceKey = process.env.GHN_RATE_LIMIT_TEST_SERVICE_ROLE_KEY;
const projectRef = process.env.GHN_RATE_LIMIT_TEST_PROJECT_REF;
const confirmDisposable = process.env.GHN_RATE_LIMIT_TEST_CONFIRM_DISPOSABLE === "YES";
const hasTestConfig = Boolean(url || serviceKey || projectRef || confirmDisposable);
let urlMatchesProjectRef = false;
try {
  const parsedUrl = new URL(url);
  urlMatchesProjectRef = parsedUrl.protocol === "https:" && parsedUrl.hostname === `${projectRef}.supabase.co`;
} catch {
  // Missing/invalid configuration is handled below without constructing a client.
}
const enabled = Boolean(url && serviceKey && projectRef && confirmDisposable && urlMatchesProjectRef);
if (hasTestConfig && !enabled) {
  throw new Error(
    "GHN PostgreSQL tests require a disposable Supabase project: set its URL, service key, exact project ref, and GHN_RATE_LIMIT_TEST_CONFIRM_DISPOSABLE=YES.",
  );
}
const db = enabled ? createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
const makeHash = () => randomBytes(32).toString("hex");

async function consume(ipHash, storeId) {
  const { data, error } = await db.rpc("consume_ghn_quote_rate_limit", {
    requested_ip_hash: ipHash,
    requested_store_id: storeId,
  });
  assert.ifError(error);
  const result = Array.isArray(data) ? data[0] : data;
  assert.equal(typeof result?.allowed, "boolean");
  assert.ok(Number.isInteger(result?.retry_after) && result.retry_after >= 1 && result.retry_after <= 60);
  return result;
}

async function consumeConcurrently(requests, batchSize = 50) {
  const results = [];
  for (let index = 0; index < requests.length; index += batchSize) {
    results.push(...await Promise.all(requests.slice(index, index + batchSize).map(({ ip, store }) => consume(ip, store))));
  }
  return results;
}

test("Postgres blocks request 61 for an IP without consuming its target store", { skip: !enabled }, async () => {
  const ip = makeHash(), target = randomUUID();
  const ipResults = await consumeConcurrently(Array.from({ length: 60 }, () => ({ ip, store: randomUUID() })));
  assert.ok(ipResults.every((row) => row.allowed));
  const storeResults = await consumeConcurrently(Array.from({ length: 299 }, () => ({ ip: makeHash(), store: target })));
  assert.ok(storeResults.every((row) => row.allowed));
  const blocked = await consume(ip, target);
  assert.equal(blocked.allowed, false);
  assert.equal((await consume(makeHash(), target)).allowed, true, "blocked IP must not consume store's last slot");
});

test("Postgres blocks request 301 for a store without consuming its IP quota", { skip: !enabled }, async () => {
  const store = randomUUID(), ip = makeHash();
  const storeResults = await consumeConcurrently(Array.from({ length: 300 }, () => ({ ip: makeHash(), store })));
  assert.ok(storeResults.every((row) => row.allowed));
  const ipResults = await consumeConcurrently(Array.from({ length: 59 }, () => ({ ip, store: randomUUID() })));
  assert.ok(ipResults.every((row) => row.allowed));
  assert.equal((await consume(ip, store)).allowed, false);
  assert.equal((await consume(ip, randomUUID())).allowed, true, "blocked store must not consume IP's last slot");
});

test("Postgres allows exactly 60 concurrent requests for one IP", { skip: !enabled }, async () => {
  const ip = makeHash();
  const results = await Promise.all(Array.from({ length: 61 }, () => consume(ip, randomUUID())));
  assert.equal(results.filter((row) => row.allowed).length, 60);
  assert.equal(results.filter((row) => !row.allowed).length, 1);
});

test("Postgres allows exactly 300 concurrent requests for one store", { skip: !enabled }, async () => {
  const store = randomUUID();
  const results = await Promise.all(Array.from({ length: 301 }, () => consume(makeHash(), store)));
  assert.equal(results.filter((row) => row.allowed).length, 300);
  assert.equal(results.filter((row) => !row.allowed).length, 1);
});

test("Postgres serializes concurrent calls for the same IP/store pair", { skip: !enabled, timeout: 30_000 }, async () => {
  const ip = makeHash(), store = randomUUID();
  const results = await Promise.all(Array.from({ length: 61 }, () => consume(ip, store)));
  assert.equal(results.filter((row) => row.allowed).length, 60);
  assert.equal(results.filter((row) => !row.allowed).length, 1);
});

test("Postgres avoids deadlocks across interleaved IP/store pairs", { skip: !enabled, timeout: 30_000 }, async () => {
  const ips = [makeHash(), makeHash()];
  const stores = [randomUUID(), randomUUID()];
  const pairs = [
    { ip: ips[0], store: stores[0] }, { ip: ips[0], store: stores[1] },
    { ip: ips[1], store: stores[0] }, { ip: ips[1], store: stores[1] },
  ];
  const requests = Array.from({ length: 40 }, (_, i) => pairs[i % pairs.length]);
  const results = await Promise.all(requests.map(({ ip, store }) => consume(ip, store)));
  assert.equal(results.filter((row) => row.allowed).length, 40);
});

test("Postgres concurrent requests with overlapping IP/store pairs respect both quotas", { skip: !enabled }, async () => {
  const ips = Array.from({ length: 5 }, makeHash);
  const stores = Array.from({ length: 5 }, () => randomUUID());
  const requests = Array.from({ length: 1500 }, (_, i) => ({ ip: ips[Math.floor(i / 300)], store: stores[Math.floor(i / 60) % 5] }));
  const results = await consumeConcurrently(requests);
  assert.equal(results.filter((row) => row.allowed).length, 300, "each of five IPs and five stores must stop at exactly 60 requests");
});

test("Postgres allows one valid request and starts a new window after the boundary", { skip: !enabled }, async () => {
  const ip = makeHash(), store = randomUUID();
  const first = await consume(ip, store);
  assert.equal(first.allowed, true);
  await delay((first.retry_after + 1) * 1000);
  const nextWindow = await consume(ip, store);
  assert.equal(nextWindow.allowed, true);
});

test("Postgres retry_after reports the remaining fixed window near its end", { skip: !enabled }, async () => {
  const ip = makeHash();
  const probe = await consume(ip, randomUUID());
  await delay((probe.retry_after * 1000) + 250);
  const startedAt = Date.now();
  const initial = await consume(ip, randomUUID());
  const rest = await Promise.all(Array.from({ length: 59 }, () => consume(ip, randomUUID())));
  assert.ok(rest.every((row) => row.allowed));
  while (initial.retry_after - Math.floor((Date.now() - startedAt) / 1000) > 3) await delay(250);
  const blocked = await consume(ip, randomUUID());
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retry_after >= 1 && blocked.retry_after <= 4);
});

test("Postgres RPC rejects a malformed IP hash", { skip: !enabled }, async () => {
  const { error } = await db.rpc("consume_ghn_quote_rate_limit", {
    requested_ip_hash: "not-a-64-character-hash",
    requested_store_id: randomUUID(),
  });
  assert.ok(error, "database must reject malformed IP hash");
});
