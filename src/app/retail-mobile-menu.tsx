"use client";

import Link from "next/link";
import { useRef } from "react";
import SidebarIcon from "@/app/sidebar-icon";
import "./retail-mobile-menu.css";

type Props = { storeName: string; storeSlug: string; phone: string | null; onHome?: () => void; onCategories?: () => void; onProducts?: () => void };

export default function RetailMobileMenu({ storeName, storeSlug, phone, onHome, onCategories, onProducts }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const home = `/${encodeURIComponent(storeSlug)}`;
  const close = () => dialog.current?.close();
  const navigate = (callback?: () => void, target?: string) => {
    close();
    callback?.();
    if (callback && target) requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth" })));
  };
  return <div className="retail-mobile-menu">
    <button className="retail-mobile-menu-trigger" type="button" onClick={() => dialog.current?.showModal()} aria-label="Mở menu" aria-haspopup="dialog"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>
    <dialog ref={dialog} className="retail-mobile-dialog" aria-labelledby="retail-mobile-menu-title" onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="retail-mobile-drawer"><div className="retail-mobile-drawer-header"><div><small>ĐIỀU HƯỚNG</small><strong id="retail-mobile-menu-title">{storeName}</strong></div><button type="button" onClick={close} aria-label="Đóng menu">×</button></div>
        <nav aria-label="Điều hướng cửa hàng"><Link href={onHome ? "#retail-top" : home} onClick={() => navigate(onHome, "retail-top")}><SidebarIcon name="store" />Trang chủ <span>→</span></Link><Link href={onCategories ? "#retail-categories" : `${home}#retail-categories`} onClick={() => navigate(onCategories, "retail-categories")}><SidebarIcon name="overview" />Danh mục sản phẩm <span>→</span></Link><Link href={onProducts ? "#retail-products" : `${home}#retail-products`} onClick={() => navigate(onProducts, "retail-products")}><SidebarIcon name="cart" />Sản phẩm <span>→</span></Link>{phone && <a href={`tel:${phone}`} onClick={close}><SidebarIcon name="support" />Liên hệ <span>→</span></a>}</nav>
      </div>
    </dialog>
  </div>;
}
