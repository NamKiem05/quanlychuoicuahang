import { createClient } from "@/lib/supabase/server";
import { invoiceCsvChunks, invoiceExportAuthStatus, invoiceExportMaxRows, invoiceExportPageSize } from "@/lib/admin/invoice-export";
import { filterInvoices, readInvoiceFilters } from "@/lib/admin/invoices";
import { liveSessionStatus } from "@/lib/platform-account";

export const maxDuration = 60;
const columns = "invoice_number, store_name, customer_name, plan_name, amount_vnd, paid_vnd, balance_vnd, invoice_status, payment_status, transfer_code, payment_method, transaction_reference, issued_at, due_on, paid_at";
const databaseError = () => new Response("Không tải được báo cáo.", { status: 500 });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = readInvoiceFilters((key) => params.get(key));
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return databaseError();
  }

  const authStatus = await invoiceExportAuthStatus(supabase);
  if (authStatus !== 200) {
    return new Response(authStatus === 401 ? "Unauthorized" : authStatus === 403 ? "Forbidden" : "Không tải được báo cáo.", { status: authStatus });
  }

  let highWater;
  try {
    const session = await liveSessionStatus(supabase);
    const headers = { "Cache-Control": "private, no-store" };
    if (session === "expired") return new Response("Phiên làm việc đã hết hạn.", { status: 401, headers });
    if (session !== "active") return new Response("Chưa thể xác minh phiên làm việc.", { status: 503, headers });
    const bounds = supabase.from("admin_service_invoice_view").select("invoice_number", { count: "exact" });
    filterInvoices(bounds, filters);
    highWater = await bounds
      .order("invoice_number", { ascending: false })
      .limit(1)
      .abortSignal(AbortSignal.timeout(8000))
      .maybeSingle();
  } catch {
    return databaseError();
  }
  if (highWater.error) return databaseError();
  if (highWater.count == null) return databaseError();
  if (highWater.count > invoiceExportMaxRows) {
    return new Response("Thu hẹp bộ lọc để xuất tối đa 50.000 hóa đơn.", { status: 413 });
  }

  try {
    const chunks = invoiceCsvChunks(async (after, through, limit) => {
      if (request.signal.aborted) return { data: null, error: request.signal.reason };
      const rows = supabase.from("admin_service_invoice_view").select(columns);
      filterInvoices(rows, filters);
      const page = await rows
        .gt("invoice_number", after)
        .lte("invoice_number", through)
        .order("invoice_number", { ascending: true })
        .limit(Math.min(limit, invoiceExportPageSize))
        .abortSignal(AbortSignal.timeout(8000));
      return { data: page.data, error: page.error };
    }, highWater.data?.invoice_number ?? null);
    const first = await chunks.next();
    const second = await chunks.next();
    const encoder = new TextEncoder();
    const csv = new ReadableStream({
      start(controller) {
        if (!first.done) controller.enqueue(encoder.encode(first.value));
        if (!second.done) controller.enqueue(encoder.encode(second.value));
        else controller.close();
      },
      async pull(controller) {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      },
      async cancel() { await chunks.return(undefined); },
    });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="bao-cao-chung-tu-dich-vu.csv"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVOICE_EXPORT_LIMIT") {
      return new Response("Báo cáo vượt giới hạn xuất. Hãy liên hệ quản trị viên.", { status: 413 });
    }
    return databaseError();
  }
}
