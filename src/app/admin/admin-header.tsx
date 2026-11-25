"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/(merchant)/dashboard/actions";
import { adminHeaderRoutes } from "./admin-navigation";
import { useAdminChatNotifications } from "./admin-chat-notifications";
import "./admin-header.css";

type Props = { storeError: boolean; name: string; userId: string; supportOnly: boolean; stores: { id: string; name: string }[] };
const extraLabels: Record<string, string> = { new: "Tạo mới", edit: "Chỉnh sửa", delete: "Xóa cửa hàng", email: "Cấu hình email", shipping: "Vận chuyển" };
const icons = {
  sidebar: "M3 4h18v16H3z M9 4v16", search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0z M15 15l6 6",
  bell: "M4 17h16l-2-3V9a6 6 0 0 0-12 0v5z M10 20q2 3 4 0",
  external: "M14 3h7v7 M21 3l-11 11 M10 5H4v15h15v-6",
};
function Icon({ name }: { name: keyof typeof icons }) {
  return <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={icons[name]} /></svg>;
}
function normalize(value: string) {
  return value.toLocaleLowerCase("vi").normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");
}
export default function AdminHeader(props: Props) {
  const path = usePathname();
  return <HeaderControls key={path} path={path} {...props} />;
}
function HeaderControls({ path, name, userId, supportOnly, stores, storeError }: Props & { path: string }) {
  const [panel, setPanel] = useState<"search" | "bell" | "profile" | null>(null);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const { unreadByStore, markStoreRead } = useAdminChatNotifications();
  const unread = Object.entries(unreadByStore).filter(([, count]) => count > 0);
  const count = unread.reduce((sum, [, n]) => sum + n, 0);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setPanel("search"); input.current?.focus();
      }
      if (event.key === "Escape" && panel) {
        setPanel(null);
        root.current?.querySelector<HTMLButtonElement>(`[data-trigger="${panel}"]`)?.focus();
      }
    }
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setPanel(null);
    }
    document.addEventListener("keydown", keyboard);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", keyboard); document.removeEventListener("pointerdown", outside); };
  }, [panel]);
  useEffect(() => { if (panel === "search") input.current?.focus(); }, [panel]);

  const routes = adminHeaderRoutes.filter(route => !supportOnly || route.href === "/admin/tickets");
  const term = normalize(query.trim());
  const matches = routes.filter(route => normalize(route.label).includes(term)).slice(0, 7);
  const storeMatches = term ? stores.filter(store => normalize(store.name).includes(term)).slice(0, 4) : [];
  const role = supportOnly ? "Nhân viên hỗ trợ" : "Quản trị viên nền tảng";
  const segments = path.split("/").filter(Boolean);
  return <header className="gd-header" ref={root} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setPanel(null); }}>
    <button type="button" className="gd-icon" aria-label={sidebarHidden ? "Mở menu điều hướng" : "Thu gọn menu điều hướng"} aria-controls="platform-sidebar" aria-expanded={!sidebarHidden} data-sidebar-hidden={sidebarHidden} onClick={() => { setSidebarHidden(!sidebarHidden); setPanel(null); }}><Icon name="sidebar" /></button>
    <nav className="gd-crumb" aria-label="Đường dẫn trang">{segments.map((segment, i) => {
      const href = "/" + segments.slice(0, i + 1).join("/");
      const route = routes.find(item => item.href === href);
      const label = route?.label ?? extraLabels[segment] ?? (i === 0 ? "Quản trị" : "Chi tiết");
      const last = i === segments.length - 1;
      return <span key={href}>{i > 0 && <i aria-hidden="true">/</i>}{!last && (route || (i === 2 && segments[1] === "stores")) ? <Link href={href}>{label}</Link> : <b aria-current={last ? "page" : undefined}>{label}</b>}</span>;
    })}</nav>
    <div className="gd-anchor gd-find"><button type="button" data-trigger="search" aria-expanded={panel === "search"} aria-label="Tìm kiếm nhanh" onClick={() => setPanel(panel === "search" ? null : "search")}><Icon name="search"/><span>{supportOnly ? "Tìm trang hỗ trợ…" : "Tìm trang, cửa hàng…"}</span><kbd>Ctrl / ⌘ K</kbd></button>
    {panel === "search" && <section className="gd-pop"><input ref={input} aria-label="Từ khóa tìm kiếm" placeholder={supportOnly ? "Tìm trang hỗ trợ…" : "Tìm trang, cửa hàng, đơn hàng…"} value={query} onChange={e => setQuery(e.target.value)} />
      {matches.map(item => <Link key={item.href} href={item.href} onClick={() => setPanel(null)}>{item.label}</Link>)}
      {storeMatches.map(store => <Link key={store.id} href={`/admin/stores/${store.id}`}>{store.name}<small>Cửa hàng</small></Link>)}
      {storeError && term && <p role="status">Không tải được gợi ý cửa hàng. Anh có thể tải lại trang để thử lại.</p>}
      {!matches.length && !storeMatches.length && <p role="status">Không tìm thấy kết quả gợi ý.</p>}
      {!supportOnly && term && <Link href={`/admin/orders?q=${encodeURIComponent(query.trim())}`} onClick={() => setPanel(null)}>Tìm trong đơn hàng →</Link>}
    </section>}</div>
    <Link className="gd-icon gd-quick" aria-label="Trang giới thiệu" title="Trang giới thiệu" href="/"><Icon name="external"/></Link>
    <div className="gd-anchor"><button className="gd-icon" type="button" data-trigger="bell" aria-label={`Thông báo, ${count} chưa đọc`} aria-expanded={panel === "bell"} onClick={() => setPanel(panel === "bell" ? null : "bell")}><Icon name="bell"/>{count > 0 && <sup>{count}</sup>}</button>
    {panel === "bell" && <section className="gd-pop"><strong>Thông báo</strong>{!unread.length && <p>{supportOnly ? "Chưa có nguồn thông báo dành cho nhân viên hỗ trợ." : "Chưa có tin nhắn mới trong phiên này."}</p>}
      {unread.map(([id, n]) => <div key={id}><Link href={`/admin/messages?store=${id}`} onClick={() => markStoreRead(id)}>{stores.find(s => s.id === id)?.name ?? "Cửa hàng"} · {n} tin mới</Link><button onClick={() => markStoreRead(id)}>Đánh dấu đã đọc</button></div>)}
      {!supportOnly && <><Link href="/admin/messages">Xem tất cả tin nhắn →</Link><Link href="/admin/notifications">Thông báo đã gửi →</Link></>}</section>}</div>
    <div className="gd-anchor"><button className="gd-account" type="button" data-trigger="profile" aria-label="Menu tài khoản" aria-expanded={panel === "profile"} onClick={() => setPanel(panel === "profile" ? null : "profile")}><span>{name.trim().charAt(0).toLocaleUpperCase("vi")}</span><span className="gd-identity"><b>{name}</b><small>{role}</small></span></button>
    {panel === "profile" && <section className="gd-pop"><strong>{name}</strong><p>{role}</p>{!supportOnly && <><Link href={`/admin/admins/${userId}`}>Hồ sơ cá nhân</Link><Link href={`/admin/admins/${userId}#account-settings`}>Cài đặt tài khoản</Link></>}<form action={signOut}><button type="submit">Đăng xuất</button></form></section>}</div>
  </header>;
}

