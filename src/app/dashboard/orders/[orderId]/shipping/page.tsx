import Link from "next/link";
import { notFound,redirect } from "next/navigation";
import { getMerchantContext,formatPrice } from "@/app/dashboard/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptGhnToken,ghnLocations,type GhnLocation } from "@/lib/shipping/ghn";
import type { GhnCheckoutSnapshot } from "@/lib/shipping/packaging";
import ShipmentForm from "./shipment-form";
import ShipmentStatus from "./shipment-status";
import "./shipment.css";
export const metadata={title:"Vận đơn GHN | Quản lý cửa hàng"};
export const instant=false;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statusLabels: Record<string, string> = {
  ready_to_pick: "Chờ lấy hàng",
  picking: "Đang lấy hàng",
  money_collect_picking: "Đang thu tiền khi lấy hàng",
  picked: "Đã lấy hàng",
  storing: "Đang lưu kho",
  transporting: "Đang vận chuyển",
  sorting: "Đang phân loại",
  delivering: "Đang giao hàng",
  money_collect_delivering: "Đang thu hộ",
  delivered: "Đã giao hàng",
  delivery_fail: "Giao hàng thất bại",
  waiting_to_return: "Chờ hoàn hàng",
  return: "Đang chuyển hoàn",
  return_transporting: "Đang vận chuyển hàng hoàn",
  return_sorting: "Đang phân loại hàng hoàn",
  returning: "Đang trả hàng",
  return_fail: "Trả hàng thất bại",
  returned: "Đã trả hàng",
  cancel: "Đã hủy vận đơn",
  exception: "Có sự cố vận chuyển",
  lost: "Thất lạc",
  damage: "Hư hỏng",
};
const checkedAtFormat = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

export default async function ShipmentPage({params}:{params:Promise<{orderId:string}>}) {
  const {orderId}=await params;if(!uuid.test(orderId))notFound();
  const {store,membership,supabase}=await getMerchantContext();if(!store)redirect("/dashboard");if(membership?.role!=="owner")redirect("/dashboard/orders");
  const {data:order,error}=await supabase.from("orders").select("id,public_code,customer_name,customer_phone,delivery_address,fulfillment,status,payment_method,payment_status,total_vnd,delivery_fee_vnd,cancellation_request_status").eq("id",orderId).eq("store_id",store.id).maybeSingle();if(error || !order)notFound();
  let shipment: {
    state: string;
    shop_id: number;
    order_code: string | null;
    total_fee: number | null;
    provider_status: string | null;
    status_checked_at: string | null;
    request_payload: {
      to_province_name?: string;
      to_ward_name?: string;
      weight?: number;
      length?: number;
      width?: number;
      height?: number;
    } | null;
  } | null = null;
  let configured = false;
  let canSync = false;
  let loadError = false;
  let provinces: GhnLocation[] = [];
  let locationsError = false;
  let quote: GhnCheckoutSnapshot | null = null;
  try {
    const admin = createAdminClient();
    const [connection, result, snapshot] = await Promise.all([
      admin.from("store_ghn_connections").select("shop_id,token_ciphertext,environment").eq("store_id", store.id).maybeSingle(),
      admin.from("store_ghn_shipments").select("state,shop_id,order_code,total_fee,request_payload,provider_status,status_checked_at")
        .eq("order_id", orderId).eq("store_id", store.id).maybeSingle(),
      admin.from("orders").select("ghn_shipping_quote").eq("id", orderId).eq("store_id", store.id).single(),
    ]);
    if (connection.error || result.error) throw new Error("GHN_DATA_UNAVAILABLE");
    if (snapshot.error && !["42703", "PGRST204"].includes(snapshot.error.code)) throw snapshot.error;
    shipment = result.data;
    quote = snapshot.data?.ghn_shipping_quote ?? null;
    configured = connection.data?.environment === "staging" && (!quote || quote.shop_id === Number(connection.data.shop_id));
    canSync = configured && Number(connection.data?.shop_id) === Number(shipment?.shop_id);
    if (configured && connection.data && shipment?.state !== "created" && !quote) {
      try {
        provinces = await ghnLocations(decryptGhnToken(connection.data.token_ciphertext, store.id), Number(connection.data.shop_id));
      } catch {
        locationsError = true;
      }
    }
  } catch {
    loadError = true;
  }
  const eligible=order.fulfillment==="delivery" && ["confirmed","preparing","ready"].includes(order.status) && order.cancellation_request_status!=="pending";
  return <main className="admin-content ghn-shipment-page"><Link className="ghn-shipment-back" href="/dashboard/orders">← Quay lại đơn hàng</Link><header><span>VẬN CHUYỂN / GHN THỬ NGHIỆM</span><h1>{shipment?.state === "created" ? "Vận đơn GHN" : "Tạo vận đơn GHN"}</h1><p>Đơn hàng {order.public_code} · {store.name}</p></header><section className="ghn-shipment-card"><div className="ghn-shipment-summary"><div><small>Người nhận</small><b>{order.customer_name}</b><span>{order.customer_phone}</span></div><div><small>Địa chỉ trong đơn</small><b>{order.delivery_address || "Chưa có địa chỉ giao hàng"}</b></div><div><small>Tổng đơn</small><b>{formatPrice(Number(order.total_vnd))}</b><span>{order.payment_status === "paid" ? "Đã thanh toán · không thu hộ" : "Chưa thanh toán"}</span></div></div><div className="ghn-shipment-note">Phí GHN được xem trước cho chủ cửa hàng và không tự thay đổi tổng tiền đã đặt. Dữ liệu được gửi tới GHN Staging, không tạo vận đơn thật.</div>{loadError ? <p role="alert" className="ghn-shipment-error">Chưa tải được dữ liệu GHN. Hãy kiểm tra cấu hình máy chủ và cập nhật cơ sở dữ liệu.</p> : shipment?.state === "created" ? (
        <div className="ghn-shipment-success">
          <b>Đã tạo vận đơn thử nghiệm</b>
          <p>Mã vận đơn: <strong>{shipment.order_code}</strong></p>
          {shipment.request_payload && <p>Kiện thực tế: {shipment.request_payload.weight} g · {shipment.request_payload.length} × {shipment.request_payload.width} × {shipment.request_payload.height} cm.</p>}
          <p>Phí giao hàng đã chốt với khách: <strong>{formatPrice(Number(order.delivery_fee_vnd))}</strong></p>
          <p>Phí GHN thực tế: <strong>{formatPrice(Number(shipment.total_fee))}</strong></p>
          {Number(shipment.total_fee) !== Number(order.delivery_fee_vnd) && <p>Chênh lệch: GHN {Number(shipment.total_fee) > Number(order.delivery_fee_vnd) ? "cao hơn" : "thấp hơn"} phí đã chốt {formatPrice(Math.abs(Number(shipment.total_fee) - Number(order.delivery_fee_vnd)))}.</p>}
          <p>Trạng thái GHN: <strong>{shipment.provider_status
            ? (Object.hasOwn(statusLabels, shipment.provider_status) ? statusLabels[shipment.provider_status] : shipment.provider_status)
            : "Chưa đồng bộ"}</strong></p>
          {shipment.status_checked_at && <p>Cập nhật lần cuối lúc {checkedAtFormat.format(new Date(shipment.status_checked_at))}</p>}
          {!canSync && <p>Hãy <Link href="/dashboard/shipping">kết nối lại GHN</Link> với tài khoản đã tạo vận đơn để đồng bộ.</p>}
          <ShipmentStatus storeId={store.id} orderId={order.id} canSync={canSync} />
        </div>
      ) : !configured ? <p>Hãy <Link href="/dashboard/shipping">kết nối GHN thử nghiệm</Link> trước khi tạo vận đơn.</p> : !eligible ? <p role="alert" className="ghn-shipment-error">Đơn cần có hình thức giao hàng, đã được xác nhận và không có yêu cầu hủy đang chờ.</p> : <ShipmentForm key={shipment?.state ?? "new"} customerFee={Number(order.delivery_fee_vnd)} storeId={store.id} orderId={order.id} provinces={provinces} locationsError={locationsError} quote={quote} previous={shipment?.request_payload || null} pending={shipment?.state === "pending"} />}</section></main>;
}
