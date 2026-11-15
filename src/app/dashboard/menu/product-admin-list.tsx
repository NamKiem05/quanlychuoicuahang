"use client";

import { useEffect, useRef, useState } from "react";
import ProductForm from "./product-form";
import ProductOptionsManager, { type ProductOptionGroup } from "./product-options-manager";

const formatPrice = (price: number) => `${price.toLocaleString("vi-VN")}₫`;

type CategoryOption = { id: string; name: string };
type ManagedProduct = {
  id: string;
  name: string;
  price_vnd: number;
  category_id: string | null;
  status: string;
  image_url: string | null;
  description: string;
  stock_quantity: number | null;
  optionGroups: ProductOptionGroup[];
};

export default function ProductAdminList({
  storeId,
  categories,
  products,
}: {
  storeId: string;
  categories: CategoryOption[];
  products: ManagedProduct[];
}) {
  const [selectedProduct, setSelectedProduct] = useState<ManagedProduct | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!selectedProduct) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedProduct(null);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
        return;
      }
      if (event.key === "Tab") {
        const focusable = modalRef.current?.querySelectorAll<HTMLElement>("button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])");
        const enabled = Array.from(focusable ?? []).filter((element) => !element.hasAttribute("disabled"));
        if (!enabled.length) return;
        const first = enabled[0];
        const last = enabled[enabled.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedProduct]);

  function closeModal() {
    setSelectedProduct(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <>
      <div className="product-admin-list">
        {products.map((product) => (
          <article className="product-editor" key={product.id}>
            <button
              className="product-editor-summary product-manage-trigger"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={selectedProduct?.id === product.id}
              onClick={(event) => {
                triggerRef.current = event.currentTarget;
                setSelectedProduct(product);
              }}
            >
              <span className="product-editor-heading">
                <span>
                  <b>{product.name}</b>
                  <span>{formatPrice(product.price_vnd)}</span>
                  <span className="field-hint">{product.stock_quantity == null ? "Không giới hạn" : product.stock_quantity === 0 ? "Hết hàng" : `Còn ${product.stock_quantity} món`}</span>
                </span>
                <span className={`status-badge status-${product.status}`}>{product.status === "active" ? "Đang bán" : product.status === "draft" ? "Bản nháp" : "Đã ẩn"}</span>
              </span>
              <span className="product-editor-open-label">Quản lý món <span aria-hidden="true">↗</span></span>
            </button>
          </article>
        ))}
        {!products.length && <div className="empty-row">Chưa có món nào. Thêm món đầu tiên ở biểu mẫu bên trên.</div>}
      </div>

      {selectedProduct && (
        <div className="manage-product-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeModal();
        }}>
          <section ref={modalRef} className="manage-product-modal" role="dialog" aria-modal="true" aria-labelledby="manage-product-title">
            <header className="manage-product-modal-header">
              <div>
                <span className="dashboard-kicker">QUẢN LÝ THỰC ĐƠN</span>
                <h2 id="manage-product-title">{selectedProduct.name}</h2>
                <p>{formatPrice(selectedProduct.price_vnd)} · {selectedProduct.optionGroups.length} nhóm tùy chọn</p>
              </div>
              <button ref={closeButtonRef} className="dialog-close" type="button" onClick={closeModal} aria-label="Đóng cửa sổ quản lý món">×</button>
            </header>
            <div className="manage-product-modal-content">
              <section className="dashboard-card manage-product-edit-card">
                <div className="dashboard-card-heading">
                  <div><span className="card-number">01</span><h3>Thông tin món</h3></div>
                  <p>Cập nhật tên, giá, tồn kho và trạng thái.</p>
                </div>
                <ProductForm
                  storeId={storeId}
                  categories={categories}
                  product={{
                    id: selectedProduct.id,
                    name: selectedProduct.name,
                    price_vnd: selectedProduct.price_vnd,
                    category_id: selectedProduct.category_id,
                    status: selectedProduct.status,
                    image_url: selectedProduct.image_url,
                    description: selectedProduct.description,
                    stock_quantity: selectedProduct.stock_quantity,
                  }}
                />
              </section>
              <ProductOptionsManager productId={selectedProduct.id} groups={selectedProduct.optionGroups} />
            </div>
          </section>
        </div>
      )}
    </>
  );
}
