import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireMerchantAccount } from "@/lib/platform-account";
import { signOut } from "@/app/dashboard/actions";
import { selectStore } from "./actions";
import "./select-store.css";
import Link from "next/link";
import Image from "next/image";
import { defaultPlatformSettings, getPlatformSettings } from "@/lib/platform-settings";

export default async function SelectStore({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");
  await requireMerchantAccount(supabase);
  const query = await searchParams;
  const { settings } = await getPlatformSettings();
  const branding = settings ?? defaultPlatformSettings;
  const result = await supabase.from("store_members").select("store_id, role, stores(id, name, slug, status)").eq("user_id", userId).order("created_at").order("store_id").overrideTypes<Array<{ store_id: string; role: string; stores: { id: string; name: string; slug: string; status: string } | null }>, { merge: false }>();
  return <main className="select-store-page"><section className="select-store-card">{branding.logo_url && <Image src={branding.logo_url} width={180} height={72} alt={`Logo ${branding.platform_name}`} unoptimized style={{ objectFit: "contain" }} />}<small>KHU VỰC CỬA HÀNG</small><h1>Chọn cửa hàng</h1><p>Chọn cửa hàng bạn muốn quản lý trong phiên làm việc này.</p>{query.error && <p role="alert" className="select-store-error">Không thể chọn cửa hàng. Hãy kiểm tra quyền truy cập và thử lại.</p>}{result.error ? <p role="alert" className="select-store-error">Không tải được danh sách cửa hàng.</p> : result.data?.length ? <div className="select-store-list">{result.data.map((membership) => <form key={membership.store_id} action={selectStore}><input type="hidden" name="store_id" value={membership.store_id} /><button type="submit" disabled={!membership.stores}><span className="select-store-avatar">{membership.stores?.name.charAt(0).toLocaleUpperCase("vi-VN") ?? "?"}</span><span><b>{membership.stores?.name ?? "Không tải được cửa hàng"}</b><small>{membership.role === "owner" ? "Chủ cửa hàng" : "Nhân viên"}{membership.stores?.slug ? ` · /${membership.stores.slug}` : ""}</small></span><strong>→</strong></button></form>)}</div> : <p>Chưa có cửa hàng nào. Hãy đăng nhập lại hoặc liên hệ chủ cửa hàng để được cấp quyền.</p>}<p><Link href="/staff-invitations">Xem lời mời cửa hàng →</Link></p><form action={signOut}><button className="select-store-signout" type="submit">Đăng xuất</button></form></section></main>;
}
