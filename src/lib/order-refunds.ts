export function isRefundableOrder(order: {
  status: string;
  payment_method: string;
  payment_status: string;
  total_vnd: number;
}) {
  return (order.status === "cancelled" || order.status === "rejected")
    && order.payment_method === "bank_transfer"
    && order.payment_status === "paid"
    && Number(order.total_vnd) > 0;
}
