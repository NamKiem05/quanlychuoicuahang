import Link from "next/link";

export type ShippingQuery = Record<string, string | string[] | undefined>;
export const pageSize = 20;

export function readPage(value: ShippingQuery[string]) {
  return typeof value === "string" && /^[1-9][0-9]{0,4}$/.test(value) ? Number(value) : 1;
}

export function Pagination({ page, total, path, params }: {
  page: number; total: number; path: string; params: Record<string, string>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1 && page === 1) return null;
  const href = (target: number) => `${path}?${new URLSearchParams({ ...params, page: String(target) })}`;
  return <nav className="order-pagination" aria-label="Phân trang">
    <span>Trang {page} / {pages}</span>
    <div className="order-pagination-controls">
      {page > 1 && <Link href={href(Math.min(page - 1, pages))}>Trang trước</Link>}
      {page < pages && <Link href={href(page + 1)}>Trang sau</Link>}
    </div>
  </nav>;
}
