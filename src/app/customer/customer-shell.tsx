"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SidebarIcon from "@/app/sidebar-icon";
import RetailAccountLink from "@/app/retail-account-link";
import RetailMobileMenu from "@/app/retail-mobile-menu";
import { createClient } from "@/lib/supabase/client";

type Store = { id: string; name: string; slug: string; logo_url: string | null; phone: string | null };
export default function CustomerShell({ children, store, name }: { children: React.ReactNode; store: Store | null; name: string }) {
  const path = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [count, setCount] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  useEffect(() => { if (!store) return; const frame = requestAnimationFrame(() => { try { const lines: unknown = JSON.parse(sessionStorage.getItem(`growdesk-cart:${store.id}`) || "[]"); if (Array.isArray(lines)) setCount(lines.reduce((sum, line) => sum + (Number.isInteger(line?.quantity) ? line.quantity : 0), 0)); } catch {} }); return () => cancelAnimationFrame(frame); }, [store]);
  const home = store ? `/${encodeURIComponent(store.slug)}` : "/";
  async function signOut() { setSigningOut(true); setSignOutError(false); const { error } = await createClient().auth.signOut(); if (error) { setSigningOut(false); setSignOutError(true); return; } router.push(home); router.refresh(); }
  return <div className="retail-store customer-portal">
    {store ? <><header className="retail-topbar"><Link className="retail-brand" href={home}>{store.logo_url ? <Image src={store.logo_url} alt="" width={44} height={44} unoptimized /> : <span aria-hidden="true">▣</span>}<strong>{store.name}</strong></Link><form className="retail-search" role="search" onSubmit={event => { event.preventDefault(); router.push(`${home}?search=${encodeURIComponent(search)}#retail-products`); }}><input type="search" placeholder="Tìm kiếm sản phẩm, danh mục..." aria-label="Tìm kiếm sản phẩm" value={search} onChange={event => setSearch(event.target.value)} /><button type="submit" aria-label="Tìm kiếm"><SidebarIcon name="search" /></button></form><div className="retail-top-actions"><RetailAccountLink storeSlug={store.slug} /><Link href={`${home}?cart=1`} aria-label={`Giỏ hàng, ${count} sản phẩm`}><span className="retail-cart-icon"><SidebarIcon name="cart" />{count > 0 && <b>{count}</b>}</span><span>Giỏ hàng</span></Link><RetailMobileMenu storeName={store.name} storeSlug={store.slug} phone={store.phone} /></div></header><nav className="retail-nav" aria-label="Điều hướng cửa hàng"><Link className="retail-categories-button" href={`${home}#retail-categories`}>☰ <span>Danh mục sản phẩm</span></Link><Link href={home}>Trang chủ</Link><Link href={`${home}#retail-products`}>Sản phẩm</Link>{store.phone && <a href={`tel:${store.phone}`}>Liên hệ</a>}</nav></> : <header className="customer-portal-fallback"><Link href="/">GrowDesk</Link><Link href="/">Trang chủ</Link></header>}
    <div className="customer-portal-layout"><aside className="customer-portal-sidebar"><div className="customer-portal-identity"><span aria-hidden="true">{name.charAt(0).toLocaleUpperCase("vi-VN")}</span><div><b>{name}</b><small>Thành viên</small></div></div><nav aria-label="Tài khoản"><Link href="/customer/account" className={path === "/customer/account" ? "active" : ""} aria-current={path === "/customer/account" ? "page" : undefined}><SidebarIcon name="accounts" />Thông tin tài khoản</Link><Link href="/customer/orders" className={path.startsWith("/customer/orders") ? "active" : ""} aria-current={path.startsWith("/customer/orders") ? "page" : undefined}><SidebarIcon name="orders" />Đơn hàng của tôi</Link><span aria-disabled="true"><SidebarIcon name="reviews" />Yêu thích <small>Sắp có</small></span><Link href="/customer/addresses" className={path.startsWith("/customer/addresses") ? "active" : ""} aria-current={path.startsWith("/customer/addresses") ? "page" : undefined}><SidebarIcon name="delivery" />Địa chỉ nhận hàng</Link><span aria-disabled="true"><SidebarIcon name="promotions" />Mã giảm giá <small>Sắp có</small></span><span aria-disabled="true"><SidebarIcon name="support" />Thông báo <small>Sắp có</small></span></nav><button className="customer-portal-signout" onClick={signOut} disabled={signingOut}><SidebarIcon name="lock" />{signingOut ? "Đang đăng xuất..." : "Đăng xuất"}</button>{signOutError && <p role="alert">Không thể đăng xuất. Vui lòng thử lại.</p>}</aside><main className="customer-portal-content">{children}</main></div>
  </div>;
}
