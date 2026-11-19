import Link from "next/link";
import { redirect } from "next/navigation";
import { getMerchantContext } from "../data";
import { createAdminClient } from "@/lib/supabase/admin";
import GhnConnectionForm from "./connection-form";
import "./shipping.css";
export const metadata = {title:"Vận chuyển | Quản lý cửa hàng"};
export const instant = false;
export default async function ShippingPage() {
  const {store,membership}=await getMerchantContext(); if(!store || !membership) redirect("/dashboard");
  let connection:{shop_id:number;shop_name:string;checked_at:string}|null=null; let unavailable=false;
  if(membership.role === "owner") {
    try {const {data,error}=await createAdminClient().from("store_ghn_connections").select("shop_id,shop_name,checked_at").eq("store_id",store.id).maybeSingle(); if(error) unavailable=true; else connection=data;} catch {unavailable=true;}
  }
  return <main className="admin-content shipping-page"><header><span>CỬA HÀNG / VẬN CHUYỂN</span><h1>Quản lý vận chuyển</h1><p>Kết nối dịch vụ vận chuyển cho {store.name}.</p></header><section className="shipping-card"><div className="shipping-card-heading"><div><span className="shipping-kicker">DỊCH VỤ VẬN CHUYỂN</span><h2>Giao Hàng Nhanh <small>GHN</small></h2><p>Kết nối cửa hàng GHN của bạn trên môi trường thử nghiệm.</p></div><span className={connection ? "shipping-status connected" : "shipping-status"}>{connection ? "Đã kết nối thử nghiệm" : "Chưa kết nối"}</span></div><div className="shipping-notice"><b>Đang triển khai kết nối thử nghiệm</b><p>Bước này xác thực token và cửa hàng GHN. Tính phí, tạo vận đơn và đồng bộ trạng thái sẽ được triển khai tiếp sau khi kiểm thử kết nối.</p></div>{membership.role !== "owner" ? <p className="shipping-note">Chỉ chủ cửa hàng có thể quản lý thông tin kết nối GHN.</p> : unavailable ? <p className="shipping-error" role="alert">Chưa tải được cấu hình GHN. Hãy kiểm tra cấu hình máy chủ và cập nhật cơ sở dữ liệu.</p> : <GhnConnectionForm storeId={store.id} connection={connection} />}</section><section className="shipping-card shipping-self"><div><h2>Giao hàng của cửa hàng</h2><p>Thiết lập giao hàng theo bán kính và phí cố định.</p></div><Link href="/dashboard/store#delivery-settings">Cấu hình giao hàng →</Link></section></main>;
}
