export const invoiceExportPageSize = 1000;
export const invoiceExportMaxRows = 50000;

const headers = [
  "Số chứng từ", "Cửa hàng", "Khách hàng", "Gói", "Tổng tiền VND", "Đã thu VND", "Còn phải trả VND",
  "Trạng thái chứng từ", "Trạng thái giao dịch", "Mã thanh toán", "Phương thức", "Tham chiếu giao dịch",
  "Ngày phát hành", "Hạn thanh toán", "Ngày thanh toán",
];

type InvoiceExportAuthClient = {
  auth: { getClaims: () => PromiseLike<{ data: { claims?: { sub?: unknown } } | null; error: unknown }> };
  rpc: (name: "is_platform_admin") => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function invoiceExportAuthStatus(client: InvoiceExportAuthClient): Promise<401 | 403 | 500 | 200> {
  try {
    const auth = await client.auth.getClaims();
    if (auth.error) return 500;
    if (typeof auth.data?.claims?.sub !== "string" || !auth.data.claims.sub) return 401;

    const admin = await client.rpc("is_platform_admin");
    if (admin.error) return 500;
    return admin.data === true ? 200 : 403;
  } catch {
    return 500;
  }
}

export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function invoiceNumber(value: unknown): bigint | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? BigInt(value) : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    return parsed > BigInt("0") && parsed <= BigInt("9223372036854775807") ? parsed : null;
  } catch {
    return null;
  }
}

type InvoiceRow = {
  invoice_number: unknown;
  customer_name: unknown;
  plan_name: unknown;
  amount_vnd: unknown;
  invoice_status: unknown;
  payment_status: unknown;
  transfer_code: unknown;
  issued_at: unknown;
  paid_at: unknown;
  store_name?: unknown;
  paid_vnd?: unknown;
  balance_vnd?: unknown;
  due_on?: unknown;
  payment_method?: unknown;
  transaction_reference?: unknown;
};
type InvoicePageResult = { data: InvoiceRow[] | null; error: unknown };
type FetchInvoicePage = (after: string, through: string, limit: number) => Promise<InvoicePageResult>;

function recordLine(row: InvoiceRow): string {
  const key = invoiceNumber(row.invoice_number);
  if (key === null) throw new Error("INVOICE_EXPORT_DATA_INVALID");
  return [
    `DV-${key.toString().padStart(6, "0")}`, row.store_name, row.customer_name, row.plan_name, row.amount_vnd,
    row.paid_vnd, row.balance_vnd, row.invoice_status, row.payment_status, row.transfer_code,
    row.payment_method, row.transaction_reference, row.issued_at, row.due_on, row.paid_at,
  ].map(csvCell).join(",");
}

export async function* invoiceCsvChunks(fetchPage: FetchInvoicePage, highWaterMark: unknown) {
  const upperBound = highWaterMark == null ? null : invoiceNumber(highWaterMark);
  if (highWaterMark != null && upperBound === null) throw new Error("INVOICE_EXPORT_DATA_INVALID");
  yield `\uFEFF${headers.map(csvCell).join(",")}`;
  if (upperBound === null) return;

  let cursor = BigInt("0");
  let count = 0;
  while (cursor < upperBound) {
    if (count === invoiceExportMaxRows) {
      const probe = await fetchPage(cursor.toString(), upperBound.toString(), 1);
      if (probe.error) throw new Error("INVOICE_EXPORT_DATABASE_ERROR");
      if (!Array.isArray(probe.data)) throw new Error("INVOICE_EXPORT_DATABASE_ERROR");
      if (probe.data.length > 0) throw new Error("INVOICE_EXPORT_LIMIT");
      break;
    }

    const pageLimit = Math.min(invoiceExportPageSize, invoiceExportMaxRows - count);
    const result = await fetchPage(cursor.toString(), upperBound.toString(), pageLimit);
    if (result.error || !Array.isArray(result.data)) throw new Error("INVOICE_EXPORT_DATABASE_ERROR");
    if (!result.data.length) break;

    let nextCursor = cursor;
    const lines: string[] = [];
    for (const row of result.data) {
      const key = invoiceNumber(row.invoice_number);
      if (key === null || key <= nextCursor || key > upperBound) throw new Error("INVOICE_EXPORT_DATA_INVALID");
      lines.push(recordLine(row));
      nextCursor = key;
      count++;
    }
    cursor = nextCursor;
    yield `\r\n${lines.join("\r\n")}`;
    if (result.data.length < pageLimit) break;
  }

}

export async function buildInvoiceCsv(fetchPage: FetchInvoicePage, highWaterMark: unknown): Promise<string> {
  let csv = "";
  for await (const chunk of invoiceCsvChunks(fetchPage, highWaterMark)) csv += chunk;
  return csv;
}
