import { isRefundableOrder } from "./order-refunds";

type OrderForProcessing = Parameters<typeof isRefundableOrder>[0] & {
  cancellation_request_status: string;
};

export function canConfirmOrderBankTransfer(order: OrderForProcessing) {
  return order.payment_method === "bank_transfer"
    && order.payment_status === "awaiting_payment"
    && order.status !== "cancelled"
    && order.status !== "rejected"
    && order.cancellation_request_status !== "pending";
}

export function hasOrderWorkRemaining(order: OrderForProcessing, refundedAt?: string | null) {
  return !["completed", "cancelled", "rejected"].includes(order.status)
    || order.cancellation_request_status === "pending"
    || canConfirmOrderBankTransfer(order)
    || (isRefundableOrder(order) && !refundedAt);
}
