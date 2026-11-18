"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { updateStoreStatus } from "../actions";
import "./store-actions.css";

export default function StoreActions({ storeId, storeName, status, search, filterStatus }: { storeId: string; storeName: string; status: string; search: string; filterStatus: string }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  function action(value: string, label: string, danger = false) {
    return <form action={updateStoreStatus} key={value}>
      <input type="hidden" name="store_id" value={storeId} />
      <input type="hidden" name="filter_q" value={search} />
      <input type="hidden" name="filter_status" value={filterStatus} />
      <button type="submit" name="status" value={value} className={danger ? "store-action-danger" : undefined}>{label}</button>
    </form>;
  }

  return <div className="store-actions" ref={container}>
    <button ref={trigger} className="store-actions-trigger" type="button" aria-label={`Thao tác với ${storeName}`} aria-expanded={open} aria-controls={`store-actions-${storeId}`} onClick={() => setOpen((current) => !current)}>⋯</button>
    {open && <div className="store-actions-menu" id={`store-actions-${storeId}`}>
      <Link href={`/admin/stores/${storeId}`} onClick={() => setOpen(false)}>Xem chi tiết</Link>
      <Link href={`/admin/stores/${storeId}/edit`} onClick={() => setOpen(false)}>Chỉnh sửa</Link>
      {status !== "active" ? action("active", status === "draft" ? "Duyệt cửa hàng" : status === "suspended" ? "Mở khóa" : "Kích hoạt") : action("paused", "Tạm dừng")}
      {status !== "suspended" && action("suspended", "Tạm khóa", true)}
      <Link className="store-action-danger" href={`/admin/stores/${storeId}/delete`} onClick={() => setOpen(false)}>Xóa cửa hàng</Link>
      <span className="store-action-unavailable" title="Chưa thiết lập quy trình khôi phục mật khẩu">Đặt lại mật khẩu · Sắp có</span>
      <span className="store-action-unavailable" title="Chưa thiết lập quyền hỗ trợ và nhật ký truy cập">Đăng nhập hỗ trợ · Sắp có</span>
    </div>}
  </div>;
}
