"use client";

import { useFormStatus } from "react-dom";
import { cancelMerchantPlanPayment } from "./actions";

function CancelButton() {
  const { pending } = useFormStatus();
  return <button type="submit" className="secondary-submit merchant-plan-cancel" disabled={pending}>{pending ? "Đang hủy…" : "Hủy yêu cầu thanh toán"}</button>;
}

export default function CancelPayment({ paymentCode }: { paymentCode: string }) {
  return (
    <form action={cancelMerchantPlanPayment.bind(null, paymentCode)} onSubmit={(event) => {
      if (!window.confirm("Hủy mã chuyển khoản này? Nếu đã chuyển tiền, hãy giữ yêu cầu để hệ thống xác nhận.")) event.preventDefault();
    }}>
      <CancelButton />
    </form>
  );
}
