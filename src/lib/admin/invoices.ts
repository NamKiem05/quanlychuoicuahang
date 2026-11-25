export const invoiceStatuses = {
  unpaid: "Chưa thanh toán", overdue: "Quá hạn", paid: "Đã thanh toán",
  cancelled: "Đã hủy", review: "Cần đối soát",
} as const;
export const invoicePlans = { basic: "Gói Cơ bản", plus: "Gói Nâng cao" } as const;
export const invoiceUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dates = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const localDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });
export const invoiceMoney = (value: number) => money.format(value);
export const invoiceCode = (value: number | string) => `DV-${String(value).padStart(6, "0")}`;
export const invoiceDay = (value: string | null) => value ? dates.format(new Date(value)) : "—";
export const todayInVietnam = () => localDay.format(new Date());
export const invoiceVietnamDay = (value: string) => localDay.format(new Date(value));
export function invoiceStatusLabel(value: unknown) {
  return typeof value === "string" && Object.hasOwn(invoiceStatuses, value)
    ? invoiceStatuses[value as keyof typeof invoiceStatuses] : "—";
}

export function validInvoiceDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export type InvoiceSearchParams = Record<string, string | string[] | undefined>;

export function readInvoiceFilters(get: (key: string) => unknown) {
  function day(key: string) {
    const value = get(key);
    return typeof value === "string" && validInvoiceDay(value) ? value : "";
  }
  const query = get("q");
  const status = get("status");
  const plan = get("plan");
  return {
    q: typeof query === "string" ? query.slice(0, 80).replace(/[^\p{L}\p{M}\p{N}\s.-]/gu, " ").replace(/\s+/g, " ").trim() : "",
    status: typeof status === "string" && Object.hasOwn(invoiceStatuses, status) ? status : "",
    plan: typeof plan === "string" && Object.hasOwn(invoicePlans, plan) ? plan : "",
    issuedFrom: day("issuedFrom"), issuedTo: day("issuedTo"), dueFrom: day("dueFrom"), dueTo: day("dueTo"),
    order: get("order") === "oldest" ? "oldest" : "",
  };
}

type Filters = ReturnType<typeof readInvoiceFilters>;
type InvoiceFilterQuery = {
  eq(column: string, value: string): unknown;
  gte(column: string, value: string): unknown;
  lte(column: string, value: string): unknown;
  lt(column: string, value: string): unknown;
  or(conditions: string): unknown;
};

export function filterInvoices(request: InvoiceFilterQuery, filters: Filters) {
  if (filters.status) request.eq("invoice_status", filters.status);
  if (filters.plan) request.eq("plan_code", filters.plan);
  if (filters.issuedFrom) request.gte("issued_at", `${filters.issuedFrom}T00:00:00+07:00`);
  if (filters.issuedTo) {
    const end = new Date(`${filters.issuedTo}T00:00:00+07:00`);
    end.setUTCDate(end.getUTCDate() + 1);
    request.lt("issued_at", end.toISOString());
  }
  if (filters.dueFrom) request.gte("due_on", filters.dueFrom);
  if (filters.dueTo) request.lte("due_on", filters.dueTo);
  if (filters.q) {
    const term = `*${filters.q}*`;
    const conditions = [`customer_name.ilike.${term}`, `store_name.ilike.${term}`, `store_slug.ilike.${term}`, `transfer_code.ilike.${term}`];
    const match = /^(?:DV-)?0*([1-9][0-9]{0,17})$/i.exec(filters.q);
    if (match) conditions.push(`invoice_number.eq.${match[1]}`);
    request.or(conditions.join(","));
  }
}

export function invoiceQuery(filters: Filters, page?: number) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value) params.set(name, value);
  if (page && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `?${query}` : "";
}
