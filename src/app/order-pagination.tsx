import Link from "next/link";

type OrderPaginationProps = {
  basePath: string;
  currentPage: number;
  pageSize: number;
  totalItems: number;
  query: Record<string, string>;
};

export default function OrderPagination({
  basePath,
  currentPage,
  pageSize,
  totalItems,
  query,
}: OrderPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;

  const candidates = new Set<number>([1, totalPages, currentPage]);
  for (const page of [currentPage - 1, currentPage + 1]) {
    if (page > 1 && page < totalPages) candidates.add(page);
  }
  if (currentPage <= 3) [2, 3, 4].forEach((page) => page < totalPages && candidates.add(page));
  if (currentPage >= totalPages - 2) {
    [totalPages - 3, totalPages - 2, totalPages - 1]
      .forEach((page) => page > 1 && candidates.add(page));
  }
  const pages = [...candidates].sort((left, right) => left - right);
  const pageTokens = pages.flatMap((page, index) => {
    const previous = pages[index - 1];
    return index > 0 && page - previous > 1
      ? [`ellipsis-${previous}-${page}`, page]
      : [page];
  });

  function hrefFor(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }
    params.set("page", String(page));
    return `${basePath}?${params.toString()}`;
  }

  const firstItem = (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <nav className="order-pagination" aria-label="Phân trang đơn hàng">
      <p>Hiển thị {firstItem}–{lastItem} trong {totalItems} đơn</p>
      <div className="order-pagination-controls">
        {currentPage > 1
          ? <Link className="order-page-link order-page-step" href={hrefFor(currentPage - 1)} rel="prev">← Trước</Link>
          : <span className="order-page-link order-page-step is-disabled" aria-disabled="true">← Trước</span>}
        {pageTokens.map((token) => typeof token === "number"
          ? <Link
              className={`order-page-link${token === currentPage ? " is-current" : ""}`}
              href={hrefFor(token)}
              key={token}
              aria-label={`Trang ${token}`}
              aria-current={token === currentPage ? "page" : undefined}
            >{token}</Link>
          : <span className="order-page-ellipsis" key={token} aria-hidden="true">…</span>)}
        {currentPage < totalPages
          ? <Link className="order-page-link order-page-step" href={hrefFor(currentPage + 1)} rel="next">Tiếp →</Link>
          : <span className="order-page-link order-page-step is-disabled" aria-disabled="true">Tiếp →</span>}
      </div>
    </nav>
  );
}
