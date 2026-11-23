"use client";

import { useActionState, useId, useRef, type ReactNode } from "react";
import Toast from "@/components/ui/toast";
import type { ActionResult } from "./model";

type Action = (state: ActionResult, form: FormData) => Promise<ActionResult>;
const initial: ActionResult = { ok: false, message: "" };

export function ShippingForm({ action, label, children, confirm }: {
  action: Action; label: string; children: ReactNode; confirm?: string;
}) {
  const [state, submit, pending] = useActionState(action, initial);
  return <form className="dashboard-form" action={submit} onSubmit={(event) => {
    if (confirm && !window.confirm(confirm)) event.preventDefault();
  }}>
    <fieldset disabled={pending} className="admin-shipping-fields">
      {children}
      <div><button type="submit" className="secondary-submit">{pending ? "Đang xử lý…" : label}</button></div>
    </fieldset>
    {state.message && <Toast message={state.message} variant={state.ok ? "success" : "error"} />}
    {state.message && <p role={state.ok ? "status" : "alert"}>{state.message}</p>}
  </form>;
}

export function ShippingDialog({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return <>
    <button className="secondary-submit" type="button" onClick={() => dialog.current?.showModal()}>{label}</button>
    <dialog ref={dialog} className="catalog-dialog" aria-labelledby={titleId} onClick={(event) => {
      if (event.target === event.currentTarget) dialog.current?.close();
    }}>
      <div className="catalog-dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="catalog-dialog-close" aria-label="Đóng" onClick={() => dialog.current?.close()}>×</button>
      </div>
      <div className="catalog-dialog-content">{children}</div>
    </dialog>
  </>;
}
