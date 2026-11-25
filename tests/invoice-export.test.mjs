import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInvoiceCsv, csvCell, invoiceExportAuthStatus } from "../src/lib/admin/invoice-export.ts";
import { filterInvoices, invoiceQuery, readInvoiceFilters } from "../src/lib/admin/invoices.ts";

function authClient({ claims = { sub: "user-1" }, claimsError = null, admin = true, adminError = null, throws = false } = {}) {
  return {
    auth: { getClaims: async () => {
      if (throws) throw new Error("auth transport error");
      return { data: claims ? { claims } : null, error: claimsError };
    } },
    rpc: async () => {
      if (throws) throw new Error("rpc transport error");
      return { data: admin, error: adminError };
    },
  };
}

test("invoice export distinguishes unauthenticated, forbidden, and internal auth failures", async () => {
  assert.equal(await invoiceExportAuthStatus(authClient({ claims: null })), 401);
  assert.equal(await invoiceExportAuthStatus(authClient({ admin: false })), 403);
  assert.equal(await invoiceExportAuthStatus(authClient({ claimsError: new Error("JWT service failed") })), 500);
  assert.equal(await invoiceExportAuthStatus(authClient({ adminError: new Error("RPC failed") })), 500);
  assert.equal(await invoiceExportAuthStatus(authClient({ throws: true })), 500);
  assert.equal(await invoiceExportAuthStatus(authClient()), 200);
});

test("CSV protects spreadsheet formula prefixes after leading whitespace", () => {
  for (const prefix of ["=", "+", "-", "@", "\t=", "\r=", "\n="]) {
    assert.match(csvCell(` ${prefix}1+1`), /^"'/);
  }
});

test("CSV escapes quotes, commas and line breaks and serializes null and timestamps safely", () => {
  assert.equal(csvCell('Acme, "A"\r\nLtd'), '"Acme, ""A""\r\nLtd"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell("2026-11-23T10:30:00.000Z"), '"2026-11-23T10:30:00.000Z"');
  assert.equal(csvCell(49000), '"49000"');
});

function row(invoice_number) {
  return {
    invoice_number, customer_name: "Khách", plan_name: "Gói", amount_vnd: 49000,
    invoice_status: "paid", payment_status: "approved", transfer_code: "GGP123",
    issued_at: "2026-11-23T10:30:00.000Z", paid_at: null,
  };
}

test("keyset pagination uses invoice_number, caps the export at a high-water mark, and does not duplicate rows", async () => {
  const source = Array.from({ length: 1002 }, (_, index) => row(index + 1));
  const cursors = [];
  const csv = await buildInvoiceCsv(async (after, through, limit) => {
    cursors.push([after, through]);
    const page = source.filter((item) => BigInt(item.invoice_number) > BigInt(after) && BigInt(item.invoice_number) <= BigInt(through)).slice(0, limit);
    if (after === "0") source.push(row(1003)); // inserted after the export's high-water mark
    return { data: page, error: null };
  }, 1002);
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines.length, 1003); // header plus 1002 original records
  assert.equal(lines[1].startsWith('"DV-000001"'), true);
  assert.equal(lines.at(-1).startsWith('"DV-001002"'), true);
  assert.deepEqual(cursors, [["0", "1002"], ["1000", "1002"]]);
});

test("invoice export returns a header-only CSV when no invoices exist", async () => {
  const csv = await buildInvoiceCsv(async () => { throw new Error("must not fetch an empty export"); }, null);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.equal(csv.split("\r\n").length, 1);
});

test("database errors and non-advancing pagination fail instead of looping", async () => {
  await assert.rejects(buildInvoiceCsv(async () => ({ data: null, error: new Error("db unavailable") }), 1), /INVOICE_EXPORT_DATABASE_ERROR/);
  await assert.rejects(buildInvoiceCsv(async () => ({ data: Array.from({ length: 1000 }, () => row(1)), error: null }), 2), /INVOICE_EXPORT_DATA_INVALID/);
});

test("list and CSV filters preserve dates and restrict raw filter syntax", () => {
  const input = new URLSearchParams({ q: "DV-000017", issuedFrom: "2026-11-01", issuedTo: "2026-11-30", dueTo: "2026-11-31", status: "overdue", plan: "basic" });
  const filters = readInvoiceFilters(key => input.get(key));
  const applied = [];
  const builder = Object.fromEntries(["eq", "gte", "lte", "lt", "or"].map(name => [name, (...args) => applied.push([name, ...args])]));
  filterInvoices(builder, filters);
  assert.ok(applied.some(params => params[0] === "or" && params[1].includes("invoice_number.eq.17")));
  assert.ok(applied.some(params => params[0] === "lt" && params[2] === "2026-11-30T17:00:00.000Z"));
  assert.equal(filters.dueTo, "");
  assert.match(invoiceQuery(filters, 2), /status=overdue.*page=2/);
  assert.doesNotMatch(readInvoiceFilters(() => "abc),id.eq.1,%_*").q, /[),%_*]/);
});

test("financial columns preserve amounts and neutralize transaction references", async () => {
  const csv = await buildInvoiceCsv(async () => ({ data: [{
    ...row(1), store_name: "Cửa hàng A", paid_vnd: 49000, balance_vnd: 0,
    due_on: "2026-11-24", transaction_reference: "=1+2", payment_method: "bank",
  }], error: null }), 1);
  assert.match(csv, /"Cửa hàng A"/);
  assert.match(csv, /"49000","49000","0"/);
  assert.match(csv, /"bank","'=1\+2"/);
});
