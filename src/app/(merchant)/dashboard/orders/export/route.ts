import { exportOrders, methodLabels } from "../export-data";

function escapeXml(value: unknown) { return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const result = await exportOrders(params);
  if ("error" in result) return new Response(result.error, { status: 400 });
  const rows = [["Mã đơn", "Khách hàng", "Số điện thoại", "Trạng thái", "Phương thức thanh toán", "Tổng tiền (VND)", "Ngày đặt (giờ Việt Nam)"], ...result.orders.map((o) => [o.public_code, o.customer_name, o.customer_phone, result.statusLabels[o.status] ?? o.status, methodLabels[o.payment_method] ?? o.payment_method, String(o.total_vnd), new Date(o.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })])];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Đơn hàng"><Table>${rows.map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet></Workbook>`;
  return new Response(xml, { headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": "attachment; filename=don-hang.xls", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
