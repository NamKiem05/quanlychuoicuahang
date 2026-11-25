import Link from "next/link";
import { Suspense } from "react";
import AccountConfiguration from "./account-configuration";
import { redirect } from "next/navigation";
import { getMerchantContext } from "../data";
import { createAdminClient } from "@/lib/supabase/admin";
import PackagingProfiles from "./packaging-form";
import type { PackagingProfile } from "@/lib/shipping/packaging";
import GhnConnectionForm from "./connection-form";
import "./shipping.css";
export const metadata = {title:"Vận chuyển | Quản lý cửa hàng"};
export const instant = false;
export default async function ShippingPage() {
  const {store,membership}=await getMerchantContext(); if(!store || !membership) redirect("/dashboard");
  let connection:{shop_id:number;shop_name:string;checked_at:string}|null=null; let unavailable=false;
  let packaging: PackagingProfile[] = [];
  let packagingAvailable = false;
  if(membership.role === "owner") {
    try {const {data,error}=await createAdminClient().from("store_ghn_connections").select("shop_id,shop_name,checked_at").eq("store_id",store.id).maybeSingle(); if(error) unavailable=true; else connection=data;} catch {unavailable=true;}
  }
  if (membership.role === "owner") {
    try {
      const { data, error } = await createAdminClient().from("store_ghn_packaging")
        .select("id,name,kind,packing_rule,weight_g,length_cm,width_cm,height_cm").eq("store_id", store.id).order("name").order("id");
      if (!error) {
        packaging = data;
        packagingAvailable = true;
      }
    } catch { /* Packaging migration is not available yet. */ }
  }
  return <main className="admin-content shipping-page"><header><span>CỬA HÀNG / VẬN CHUYỂN</span><h1>Cấu hình vận chuyển</h1><p>Kết nối dịch vụ vận chuyển cho {store.name}.</p><p><Link href="/dashboard/shipping/simulation">Mở mô phỏng quy trình GHN →</Link></p></header>{membership.role === "owner" && <Suspense fallback={<section className="shipping-card" role="status">Đang tải tài khoản vận chuyển…</section>}><AccountConfiguration /></Suspense>}<section className="shipping-card"><div className="shipping-card-heading"><div><span className="shipping-kicker">DỊCH VỤ VẬN CHUYỂN</span><h2>Giao Hàng Nhanh <small>GHN</small></h2><p>Kết nối cửa hàng GHN của bạn trên môi trường thử nghiệm.</p></div><span className={connection ? "shipping-status connected" : "shipping-status"}>{connection ? "Đã kết nối thử nghiệm" : "Chưa kết nối"}</span></div><div className="shipping-notice"><b>GHN Staging</b><p>Dùng thông tin người nhận thử nghiệm khi tạo vận đơn.</p></div>{membership.role !== "owner" ? <p className="shipping-note">Chỉ chủ cửa hàng có thể quản lý thông tin kết nối GHN.</p> : unavailable ? <p className="shipping-error" role="alert">Chưa tải được cấu hình GHN. Hãy kiểm tra cấu hình máy chủ và cập nhật cơ sở dữ liệu.</p> : <GhnConnectionForm storeId={store.id} connection={connection} />}</section>{packagingAvailable && <PackagingProfiles storeId={store.id} profiles={packaging} />}<section className="shipping-card shipping-self"><div><h2>Giao hàng của cửa hàng</h2><p>{store.delivery_enabled ? "Đang bật giao hàng theo bán kính và phí cố định." : "Chưa bật giao hàng của cửa hàng."}</p><p>Khách có thể chọn đến lấy hàng khi đặt đơn.</p></div><Link href="/dashboard/store#delivery-settings">Cấu hình giao hàng →</Link></section></main>;
}
