"use client";

import { VietQR } from "@viet-qr/react";

export type BankTransferDetails = {
  bank_code: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  amount: number;
  reference: string;
};

export default function BankTransferQr({ details }: { details: BankTransferDetails }) {
  return (
    <section className="bank-transfer-box" aria-label="Thông tin chuyển khoản QR">
      <div className="bank-transfer-qr">
        <VietQR
          bankId={details.bank_code}
          accountNo={details.account_number}
          accountName={details.account_name}
          amount={details.amount}
          content={details.reference}
          size={220}
          renderAs="svg"
          level="Q"
          includeMargin
        />
      </div>
      <div className="bank-transfer-details">
        <b>{details.bank_name}</b>
        <span>{details.account_name}</span>
        <code>{details.account_number}</code>
        <div><span>Số tiền</span><strong>{Number(details.amount).toLocaleString("vi-VN")}₫</strong></div>
        <div><span>Nội dung chuyển khoản</span><code>{details.reference}</code></div>
      </div>
      <p className="bank-transfer-hint">Mã QR đã điền sẵn số tiền và nội dung. Hãy kiểm tra thông tin trong ứng dụng ngân hàng trước khi xác nhận chuyển khoản.</p>
    </section>
  );
}
