"use client";

export default function PrintOrdersButton({ href }: { href: string }) {
  return <a className="merchant-order-print" href={href} target="_blank" rel="noreferrer"><span aria-hidden="true">▤</span> In danh sách</a>;
}
