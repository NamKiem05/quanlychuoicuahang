import { createClient } from "@/lib/supabase/server";

function cell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const { data: admin } = await supabase.rpc("is_platform_admin");
  if (!auth?.claims?.sub || admin !== true) return new Response("Forbidden", { status: 403 });
  const records: string[] = [["Số chứng từ", "Khách hàng", "Gói", "Số tiền VND", "Trạng thái chứng từ", "Trạng thái giao dịch", "Mã thanh toán", "Ngày tạo", "Ngày thanh toán"].map(cell).join(",")];
  for (let offset = 0; ; offset += 1000) {
    const result = await supabase.from("admin_service_invoice_view").select("invoice_number, customer_name, plan_name, amount_vnd, invoice_status, payment_status, transfer_code, issued_at, paid_at").order("invoice_number").range(offset, offset + 999);
    if (result.error) return new Response("Không tải được báo cáo.", { status: 500 });
    for (const row of result.data) records.push([`DV-${String(row.invoice_number).padStart(6, "0")}`, row.customer_name, row.plan_name, row.amount_vnd, row.invoice_status, row.payment_status, row.transfer_code, row.issued_at, row.paid_at].map(cell).join(","));
    if (result.data.length < 1000) break;
  }
  return new Response(`\uFEFF${records.join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=bao-cao-chung-tu-dich-vu.csv", "Cache-Control": "no-store" } });
}
