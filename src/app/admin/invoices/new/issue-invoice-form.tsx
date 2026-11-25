"use client";

import { useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { createInvoice } from "../actions";

function IssueButton({ reviewing }: { reviewing: boolean }) {
  const { pending } = useFormStatus();
  return <button className="invoice-primary" type="submit" disabled={pending}>{pending ? "Đang phát hành…" : reviewing ? "Xác nhận phát hành" : "Xem trước"}</button>;
}

export default function IssueInvoiceForm({ paymentId, today, earliest }: { paymentId: string; today: string; earliest: string }) {
  const [review, setReview] = useState<null | { issued: string; due: string; description: string; note: string }>(null);
  function showReview(event: FormEvent<HTMLFormElement>) {
    if (review) return;
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const issued = String(form.get("issue_on"));
    const due = String(form.get("due_on"));
    if (due < issued) {
      const input = event.currentTarget.elements.namedItem("due_on") as HTMLInputElement;
      input.setCustomValidity("Hạn thanh toán phải từ ngày phát hành trở đi.");
      input.reportValidity();
      return;
    }
    setReview({ issued, due, description: String(form.get("description")), note: String(form.get("note")) });
  }

  return <form action={createInvoice} onSubmit={showReview} className="invoice-input-form">
    <input type="hidden" name="payment_id" value={paymentId} />
    <div hidden={Boolean(review)} className="invoice-input-form">
      <label>Ngày phát hành<input type="date" name="issue_on" defaultValue={today} min={earliest} max={today} required onChange={(event) => {
        const due = event.currentTarget.form?.elements.namedItem("due_on");
        if (due instanceof HTMLInputElement) {
          due.min = event.currentTarget.value;
          due.setCustomValidity("");
        }
      }} /></label>
      <label>Hạn thanh toán<input type="date" name="due_on" defaultValue={today} min={today} required onChange={event => event.currentTarget.setCustomValidity("")} /></label>
      <label>Mô tả dịch vụ<textarea name="description" maxLength={500} rows={2} /></label>
      <label>Ghi chú nội bộ<textarea name="note" maxLength={1000} rows={2} /></label>
    </div>
    {review && <div className="invoices-note"><h2>Xác nhận nội dung phát hành</h2><p>Phát hành {review.issued} · Hạn thanh toán {review.due}</p>{review.description && <p>Mô tả dịch vụ · {review.description}</p>}{review.note && <p>Ghi chú nội bộ · {review.note}</p>}<p>Phát hành hóa đơn không xác nhận thanh toán hoặc kích hoạt gói.</p></div>}
    <div className="invoice-detail-actions">
      {review && <button type="button" onClick={() => setReview(null)}>Sửa thông tin</button>}
      <IssueButton reviewing={Boolean(review)} />
    </div>
  </form>;
}
