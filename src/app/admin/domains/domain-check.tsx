"use client";
import { useActionState } from "react";
import { checkAdminDomain, type AdminDomainCheck } from "../actions";

export default function DomainCheck({ domainId }: { domainId: string }) {
  const [state, action, pending] = useActionState(checkAdminDomain.bind(null, domainId), {} as AdminDomainCheck);
  return <div className="admin-domain-check"><form action={action}><button className="secondary-submit" type="submit" disabled={pending}>{pending ? "Đang kiểm tra…" : "Kiểm tra DNS"}</button></form>
    {state.message && <div className={`admin-domain-check-result${state.success ? " is-success" : ""}`} role="status">{state.txt && <span>{state.txt}</span>}{state.cname && <span>{state.cname}</span>}<p>{state.message}</p></div>}
  </div>;
}
