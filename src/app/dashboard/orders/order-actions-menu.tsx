"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { confirmBankTransfer, decideOrderCancellation, recordOrderRefund, sendCurrentOrderNotice, updateOrderStatus } from "../actions";

type Props = { orderId: string; orderCode: string; status: string; fulfillment: string; cancellationPending: boolean; canConfirmTransfer: boolean; canRefund: boolean; owner: boolean; filters: Record<string, string>; page: number };
export default function OrderActionsMenu(props: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    const reposition = () => { const rect = trigger.current?.getBoundingClientRect(); if (rect) setPosition({ top: Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 350)), left: Math.max(8, Math.min(rect.right - 230, window.innerWidth - 238)) }); };
    reposition(); document.addEventListener("pointerdown", close); document.addEventListener("keydown", key); window.addEventListener("resize", reposition); window.addEventListener("scroll", reposition, true);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [open]);
  function hidden() { return <><input type="hidden" name="order_id" value={props.orderId} /><input type="hidden" name="filter_query" value={props.filters.q ?? ""} /><input type="hidden" name="filter_status" value={props.filters.filter_status ?? ""} /><input type="hidden" name="filter_page" value={props.page} />{(["payment", "from", "to", "min", "max", "sort"] as const).map((key) => <input key={key} type="hidden" name={`filter_${key}`} value={props.filters[key] ?? ""} />)}</>; }
  function statusAction(status: string, label: string, danger = false) { return <form action={updateOrderStatus} key={status} onSubmit={(e) => { if (danger && !window.confirm(`${label} ${props.orderCode}?`)) e.preventDefault(); }}>{hidden()}<button name="status" value={status} type="submit" className={danger ? "is-danger" : undefined}>{label}</button></form>; }
  return <><button ref={trigger} type="button" className="merchant-order-more" aria-label={`Thao tác đơn ${props.orderCode}`} aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>{open && createPortal(<div ref={menu} className="merchant-order-action-menu" style={{ top: position.top, left: position.left }}>
    {props.cancellationPending ? <><form action={decideOrderCancellation} onSubmit={(e) => { if (!window.confirm(`Chấp nhận yêu cầu hủy ${props.orderCode}?`)) e.preventDefault(); }}>{hidden()}<button name="decision" value="accept" type="submit" className="is-danger">Chấp nhận yêu cầu hủy</button></form><form action={decideOrderCancellation}>{hidden()}<button name="decision" value="decline" type="submit">Từ chối yêu cầu hủy</button></form></> : <>
      {props.status === "pending" && <>{statusAction("confirmed", "Xác nhận đơn")}{statusAction("rejected", "Từ chối đơn", true)}</>}
      {props.status === "confirmed" && statusAction("preparing", "Chuẩn bị hàng")}
      {props.status === "preparing" && statusAction("ready", "Đóng gói / sẵn sàng")}
      {props.status === "ready" && (props.fulfillment === "delivery" ? statusAction("out_for_delivery", "Bàn giao vận chuyển") : statusAction("completed", "Hoàn tất đơn"))}
      {props.status === "out_for_delivery" && statusAction("completed", "Xác nhận giao thành công")}
      {["pending", "confirmed", "preparing"].includes(props.status) && statusAction("cancelled", "Hủy đơn", true)}
    </>}
    {props.canConfirmTransfer && <form action={confirmBankTransfer}>{hidden()}<button type="submit">Xác nhận đã nhận tiền</button></form>}
    {props.canRefund && props.owner && <form action={recordOrderRefund} onSubmit={(e) => { if (!window.confirm("Chỉ ghi nhận sau khi đã hoàn tiền cho khách. Xác nhận đã hoàn tiền?")) e.preventDefault(); }}>{hidden()}<button type="submit">Ghi nhận đã hoàn tiền</button></form>}
    {props.status !== "pending" && <form action={sendCurrentOrderNotice}>{hidden()}<button type="submit">Gửi email trạng thái cho khách</button></form>}
    {props.owner && props.fulfillment === "delivery" && !["pending","rejected"].includes(props.status) && <a href={`/dashboard/orders/${props.orderId}/shipping`}>Vận đơn GHN thử nghiệm</a>}
    {props.owner && props.fulfillment === "pickup" && ["confirmed","preparing","ready"].includes(props.status) && <p>Đơn nhận tại cửa hàng không có địa chỉ giao hàng, nên chưa thể tạo vận đơn GHN.</p>}
    <a href={`/dashboard/orders/${props.orderId}/document?type=invoice`} target="_blank" rel="noreferrer">In hóa đơn bán hàng</a><a href={`/dashboard/orders/${props.orderId}/document?type=packing`} target="_blank" rel="noreferrer">In phiếu đóng gói</a>
    <p>Thông báo trạng thái được gửi qua email khi có địa chỉ khách hàng và cấu hình gửi mail.</p>
  </div>, document.body)}</>;
}
