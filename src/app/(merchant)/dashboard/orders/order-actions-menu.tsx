"use client";

import { confirmBankTransfer, decideOrderCancellation, recordOrderRefund, sendCurrentOrderNotice, updateOrderStatus } from "../actions";

type Props = { orderId: string; orderCode: string; status: string; fulfillment: string; cancellationPending: boolean; canConfirmTransfer: boolean; canRefund: boolean; owner: boolean; filters: Record<string, string>; page: number };
export default function OrderDetailActions(props: Props) {
  const canCancel = ["pending", "confirmed", "preparing"].includes(props.status);
  function hidden() { return <><input type="hidden" name="order_id" value={props.orderId} /><input type="hidden" name="reopen_order_detail" value="yes" /><input type="hidden" name="filter_query" value={props.filters.q ?? ""} /><input type="hidden" name="filter_status" value={props.filters.filter_status ?? ""} /><input type="hidden" name="filter_page" value={props.page} />{(["payment", "from", "to", "min", "max", "sort"] as const).map((key) => <input key={key} type="hidden" name={`filter_${key}`} value={props.filters[key] ?? ""} />)}</>; }
  function statusAction(status: string, label: string, danger = false) { return <form action={updateOrderStatus} key={status} onSubmit={(e) => { if (danger && !window.confirm(`${label} ${props.orderCode}?`)) e.preventDefault(); }}>{hidden()}<button name="status" value={status} type="submit" className={danger ? "is-danger" : "is-status-next"}>{label}</button></form>; }
  return <section className="order-modal-section"><h3>Thao tác đơn hàng</h3><div className="merchant-order-detail-actions">
    {!props.cancellationPending && <>
      {props.status === "pending" && statusAction("confirmed", "Xác nhận đơn")}
      {props.status === "confirmed" && statusAction("preparing", "Chuẩn bị hàng")}
      {props.status === "preparing" && statusAction("ready", "Đóng gói / sẵn sàng")}
      {props.status === "ready" && (props.fulfillment === "delivery" ? statusAction("out_for_delivery", "Bàn giao vận chuyển") : statusAction("completed", "Hoàn tất đơn"))}
      {props.status === "out_for_delivery" && statusAction("completed", "Xác nhận giao thành công")}
    </>}
    {props.canConfirmTransfer && <form action={confirmBankTransfer}>{hidden()}<button type="submit">Xác nhận đã nhận tiền</button></form>}
    {props.canRefund && props.owner && <form action={recordOrderRefund} onSubmit={(e) => { if (!window.confirm("Chỉ ghi nhận sau khi đã hoàn tiền cho khách. Xác nhận đã hoàn tiền?")) e.preventDefault(); }}>{hidden()}<button type="submit">Ghi nhận đã hoàn tiền</button></form>}
    {props.status === "completed" && <form action={sendCurrentOrderNotice}>{hidden()}<button type="submit">Gửi lại email hoàn tất đơn</button></form>}
    {props.owner && props.fulfillment === "delivery" && !["pending","rejected"].includes(props.status) && <a href={`/dashboard/orders/${props.orderId}/shipping`}>Vận đơn GHN thử nghiệm</a>}
    {props.owner && props.fulfillment === "pickup" && ["confirmed","preparing","ready"].includes(props.status) && <p>Đơn nhận tại cửa hàng không có địa chỉ giao hàng, nên chưa thể tạo vận đơn GHN.</p>}
    <a href={`/dashboard/orders/${props.orderId}/document?type=invoice`} target="_blank" rel="noreferrer">In hóa đơn bán hàng</a><a href={`/dashboard/orders/${props.orderId}/document?type=packing`} target="_blank" rel="noreferrer">In phiếu đóng gói</a>
    {(props.cancellationPending || canCancel) && (
      <div className="merchant-order-cancellation-actions">
        {props.cancellationPending ? <>
          <form action={decideOrderCancellation} onSubmit={(e) => { if (!window.confirm(`Chấp nhận yêu cầu hủy ${props.orderCode}?`)) e.preventDefault(); }}>
            {hidden()}<button name="decision" value="accept" type="submit" className="is-danger">Chấp nhận yêu cầu hủy</button>
          </form>
          <form action={decideOrderCancellation}>{hidden()}<button name="decision" value="decline" type="submit">Từ chối yêu cầu hủy</button></form>
        </> : <>
          {props.status === "pending" && statusAction("rejected", "Từ chối đơn", true)}
          {statusAction("cancelled", "Hủy đơn", true)}
        </>}
      </div>
    )}
  </div></section>;
}
