"use client";

import { removeAdminStoreDomain } from "../actions";

export default function RemoveAdminDomainForm({ domainId, hostname }: { domainId: string; hostname: string }) {
  return (
    <form action={removeAdminStoreDomain} onSubmit={(event) => {
      if (!window.confirm(`Gỡ tên miền ${hostname} khỏi cửa hàng?`)) event.preventDefault();
    }}>
      <input type="hidden" name="domain_id" value={domainId} />
      <button className="quiet-action danger-action" type="submit">Gỡ tên miền</button>
    </form>
  );
}
