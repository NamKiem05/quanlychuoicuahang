import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { test } from "node:test";

const src = new URL("../src/", import.meta.url);
const mocks = new Map([
  ["server-only", ""],
  ["next/cache", "export const revalidatePath = () => {};"],
  ["next/navigation", 'export const redirect = (path) => { throw new Error("redirect:" + path); };'],
  ["@/lib/supabase/server", "export const createClient = () => globalThis.shippingTestSession;"],
  ["@/lib/supabase/admin", "export const createAdminClient = () => globalThis.shippingTestAdmin();"],
]);

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mocks.has(specifier)) {
      const source = encodeURIComponent(mocks.get(specifier));
      return nextResolve(`data:text/javascript,${source}`, context);
    }
    if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, src).href, context);
    if (specifier.startsWith("./") && context.parentURL?.startsWith(src.href) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { encryptShippingToken, decryptShippingToken } = await import("../src/lib/shipping/account-credentials.ts");
const { encryptGhnToken, decryptGhnToken, verifyGhnShop, ghnShipmentRequest } = await import("../src/lib/shipping/ghn.ts");
const { verifyShippingAccount } = await import("../src/app/admin/shipping/check-account.ts");
const actions = await import("../src/app/admin/shipping/actions.ts");
hooks.deregister();

const id = "43000000-0000-4000-8000-000000000001";
const credential = "shipping-test-fixture-only";
const fixtureAccount = {
  id, scope: "platform", store_id: null, provider_code: "ghn", environment: "sandbox", external_shop_id: "123",
};

function env(t, key, value) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

function form(values) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

test("credential envelope authenticates account identity and supports rolling encryption keys", (t) => {
  env(t, "SHIPPING_CREDENTIAL_ACTIVE_VERSION", "v1");
  env(t, "SHIPPING_CREDENTIAL_KEY_V1", randomBytes(32).toString("base64"));
  env(t, "SHIPPING_CREDENTIAL_KEY_V2", randomBytes(32).toString("base64"));
  const old = encryptShippingToken(credential, fixtureAccount);
  assert.match(old, /^v1:/);
  assert.ok(!old.includes(credential));
  assert.notEqual(old, encryptShippingToken(credential, fixtureAccount));
  assert.throws(() => decryptShippingToken(old, { ...fixtureAccount, environment: "production" }), /INVALID_TOKEN/);
  assert.throws(() => decryptShippingToken(old, { ...fixtureAccount, scope: "shop", store_id: id }), /INVALID_TOKEN/);
  const [version, iv, , data] = old.split(":");
  const modified = [version, iv, Buffer.alloc(16).toString("base64"), data].join(":");
  assert.throws(() => decryptShippingToken(modified, fixtureAccount), /INVALID_TOKEN/);
  process.env.SHIPPING_CREDENTIAL_ACTIVE_VERSION = "v2";
  const fresh = encryptShippingToken(credential, fixtureAccount);
  assert.match(fresh, /^v2:/);
  assert.equal(decryptShippingToken(old, fixtureAccount), credential);
  assert.equal(decryptShippingToken(fresh, fixtureAccount), credential);
});

test("connection checks fail closed and never send production or unsupported requests", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network request"); });
  env(t, "SHIPPING_GHN_SANDBOX_CHECKS_ENABLED", "false");
  const account = { ...fixtureAccount, credential_ciphertext: null };
  assert.deepEqual(await verifyShippingAccount(account, true), { status: "not_configured", error: "CHECK_DISABLED" });
  process.env.SHIPPING_GHN_SANDBOX_CHECKS_ENABLED = "true";
  assert.deepEqual(await verifyShippingAccount(account, true), { status: "not_configured", error: "TOKEN_MISSING" });
  assert.deepEqual(await verifyShippingAccount(account, false), { status: "not_configured", error: "PROVIDER_DISABLED" });
  for (const variant of [{ environment: "production" }, { environment: "simulation" }, { provider_code: "ghtk" }, { scope: "shop" }]) {
    assert.deepEqual(await verifyShippingAccount({ ...account, ...variant }, true), { status: "not_configured", error: "UNSUPPORTED" });
  }
  assert.equal(fetch.mock.calls.length, 0);
});

test("GHN checks use only Staging and normalize provider errors that contain secrets", async (t) => {
  env(t, "SHIPPING_CREDENTIAL_ACTIVE_VERSION", "v1");
  env(t, "SHIPPING_CREDENTIAL_KEY_V1", randomBytes(32).toString("base64"));
  env(t, "SHIPPING_GHN_SANDBOX_CHECKS_ENABLED", "true");
  const account = { ...fixtureAccount, credential_ciphertext: encryptShippingToken(credential, fixtureAccount) };
  let reject = false;
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    if (reject) throw new Error(credential);
    return Response.json({ code: 200, data: { shops: [{ _id: 123, status: 1, name: "Fixture" }] } });
  });
  assert.deepEqual(await verifyShippingAccount(account, true), { status: "verified", error: null });
  reject = true;
  assert.deepEqual(await verifyShippingAccount(account, true), { status: "failed", error: "PROVIDER_UNAVAILABLE" });
  for (const { arguments: [url, request] } of fetch.mock.calls) {
    assert.equal(url.origin, "https://dev-online-gateway.ghn.vn");
    assert.equal(url.pathname, "/shiip/public-api/v2/shop/all");
    assert.equal(request.headers.Token, credential);
    assert.equal(request.method, undefined);
  }
});

test("every shipping mutation authorizes before acquiring the service-role client", async () => {
  globalThis.shippingTestAdmin = () => assert.fail("privileged client acquired");
  for (const [claims, support, redirect] of [[null, false, "/login"], [{ sub: id }, false, "/admin"], [{ sub: id }, true, "/admin/tickets"]]) {
    globalThis.shippingTestSession = {
      auth: { getClaims: async () => ({ data: { claims } }) },
      rpc: async (name) => ({ data: name === "has_support_ticket_permission" && support }),
    };
    for (const action of Object.values(actions)) {
      await assert.rejects(action({}, form({ id, code: "ghn", token: credential })), { message: `redirect:${redirect}` });
    }
  }
});

test("platform account save sends encrypted values to the database and returns a safe result", async (t) => {
  env(t, "SHIPPING_CREDENTIAL_ACTIVE_VERSION", "v1");
  env(t, "SHIPPING_CREDENTIAL_KEY_V1", randomBytes(32).toString("base64"));
  globalThis.shippingTestSession = {
    auth: { getClaims: async () => ({ data: { claims: { sub: id } } }) },
    rpc: async (name) => ({ data: name === "is_platform_admin" }),
  };
  const logs = ["log", "error", "warn", "info", "debug"].map((method) => t.mock.method(console, method, () => {}));
  let saved;
  globalThis.shippingTestAdmin = () => ({
    from: (table) => {
      assert.equal(table, "shipping_provider_accounts");
      return { insert: (values) => {
        saved = values;
        return { select: () => ({ single: async () => ({ data: { id: values.id } }) }) };
      } };
    },
  });
  const fields = {
    name: "Fixture", provider_code: "ghn", environment: "sandbox", external_shop_id: "123", token: credential,
    scope: "shop", store_id: id,
  };
  const result = await actions.saveAccount({}, form(fields));
  assert.equal(result.ok, true);
  assert.equal(saved.scope, "platform");
  assert.equal(saved.store_id, null);
  assert.equal(decryptShippingToken(saved.credential_ciphertext, saved), credential);
  assert.ok(!JSON.stringify(saved).includes(credential));
  assert.ok(!JSON.stringify(result).includes(credential));
  assert.ok(!JSON.stringify(result).includes(saved.credential_ciphertext));
  globalThis.shippingTestAdmin = () => { throw new Error(credential); };
  const failure = await actions.saveAccount({}, form(fields));
  assert.equal(failure.ok, false);
  assert.ok(!JSON.stringify(failure).includes(credential));
  for (const log of logs) assert.equal(log.mock.calls.length, 0);
});

test("legacy GHN tokens and Staging shipment requests still work with their original contracts", async (t) => {
  env(t, "GHN_CREDENTIALS_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  const encoded = encryptGhnToken(credential, id);
  assert.match(encoded, /^v1:/);
  assert.equal(decryptGhnToken(encoded, id), credential);

  const fetch = t.mock.method(globalThis, "fetch", async (url) => String(url).endsWith("/shop/all?offset=0&limit=100")
    ? Response.json({ code: 200, data: { shops: [{ _id: 123, status: 1, name: "Fixture" }] } })
    : Response.json({ code: 200, data: { order_code: "DEMO123", total_fee: 21000 } }));
  assert.deepEqual(await verifyGhnShop(credential, 123), { name: "Fixture" });
  const result = await ghnShipmentRequest(credential, 123, "create", { client_order_code: `GD-${id}` });
  assert.equal(result.orderCode, "DEMO123");
  const [url, request] = fetch.mock.calls[1].arguments;
  assert.equal(url, "https://dev-online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/create");
  assert.equal(request.headers.ShopId, "123");
  assert.equal(JSON.parse(request.body).client_order_code, `GD-${id}`);
});

test("the phase 2 GHN check returns a sanitized timeout outcome", async (t) => {
  env(t, "SHIPPING_CREDENTIAL_ACTIVE_VERSION", "v1");
  env(t, "SHIPPING_CREDENTIAL_KEY_V1", randomBytes(32).toString("base64"));
  env(t, "SHIPPING_GHN_SANDBOX_CHECKS_ENABLED", "true");
  const account = { ...fixtureAccount, credential_ciphertext: encryptShippingToken(credential, fixtureAccount) };
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url, request) => {
    controller.abort(new DOMException(credential, "TimeoutError"));
    request.signal.throwIfAborted();
  });
  assert.deepEqual(await verifyShippingAccount(account, true, controller.signal), { status: "failed", error: "PROVIDER_TIMEOUT" });
});

test("checkAccount uses the authenticated actor and respects authoritative final dispositions", async () => {
  const caller = "41000000-0000-4000-8000-000000000001";
  const checkId = "44000000-0000-4000-8000-000000000001";
  const revision = "45000000-0000-4000-8000-000000000001";
  globalThis.shippingTestSession = {
    auth: { getClaims: async () => ({ data: { claims: { sub: caller } } }) },
    rpc: async (name) => ({ data: name === "is_platform_admin" }),
  };
  let disposition;
  globalThis.shippingTestAdmin = () => ({
    rpc: async (name, args) => {
      if (name === "begin_shipping_account_check") {
        assert.deepEqual(args, { target_id: id, actor: caller });
        return { data: { state: "claimed", id: checkId, revision } };
      }
      assert.equal(name, "finish_shipping_account_check");
      assert.deepEqual(args, { target_id: id, check_id: checkId, check_result: "failed", failure_code: "PROVIDER_UNAVAILABLE" });
      return { data: disposition };
    },
    from: (table) => {
      const filters = [];
      const query = {
        select: () => query,
        eq: (key, value) => { filters.push([key, value]); return query; },
        maybeSingle: async () => {
          if (table === "shipping_provider_accounts") {
            assert.deepEqual(filters, [["id", id], ["scope", "platform"], ["config_revision", revision]]);
            return { data: null };
          }
          return { data: { catalog_enabled: true } };
        },
      };
      return query;
    },
  });
  const messages = {
    superseded: /thay đổi/,
    expired: /thời hạn/,
    already_finished: /đã hoàn tất/,
    missing: /Không tìm thấy/,
    provider_disabled: /đang tắt/,
  };
  for (const [value, message] of Object.entries(messages)) {
    disposition = value;
    const result = await actions.checkAccount({}, form({ id, actor: "spoofed", actor_id: "spoofed" }));
    assert.equal(result.ok, false);
    assert.match(result.message, message);
  }
});
