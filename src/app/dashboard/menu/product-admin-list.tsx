"use client";
import Link from "next/link";
import "./product-variants-link.css";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { setProductVisibility } from "../actions";
import ProductForm from "./product-form";
import ProductOptionsManager, { type ProductOptionGroup } from "./product-options-manager";
import type { MerchandiseMode } from "@/lib/merchandise-mode";

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
  low_stock_threshold: number;
  optionGroups: ProductOptionGroup[];
};

function ProductVisibilityButton({ name, active }: { name: string; active: boolean }) {
  const { pending } = useFormStatus();
  const label = active ? "Tạm ngừng bán" : "Bật bán";
  return (
    <button type="submit" className="product-visibility-button"
      aria-label={pending ? `Đang cập nhật sản phẩm ${name}` : `${label} sản phẩm ${name}`} disabled={pending}>
      {pending ? "Đang cập nhật…" : label}
    </button>
  );
}

export default function ProductAdminList({
  storeId,
  categories,
  products,
  initialProductId,
  showLowStockThreshold,
  mode,
}: {
  storeId: string;
  categories: CategoryOption[];
  products: ManagedProduct[];
  initialProductId?: string;
  showLowStockThreshold: boolean;
  mode: MerchandiseMode;
}) {
  const [selectedProduct, setSelectedProduct] = useState<ManagedProduct | null>(() => products.find((product) => product.id === initialProductId) ?? null);
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
          <article className="product-editor product-admin-row" key={product.id}>
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
              <span className="product-admin-thumbnail" aria-hidden="true">
                {product.image_url
                  ? <Image src={product.image_url} alt="" width={56} height={56} unoptimized onError={(event) => { event.currentTarget.hidden = true; }} />
                  : null}
              </span>
              <span className="product-editor-heading">
                <span>
                  <b>{product.name}</b>
                  <span>{formatPrice(product.price_vnd)}</span>
                  <span className="field-hint">{product.stock_quantity == null ? "Không giới hạn" : product.stock_quantity === 0 ? "Hết hàng" : `Còn ${product.stock_quantity} sản phẩm`}</span>
                </span>
                <span className={`status-badge status-${product.status}`}>{product.status === "active" ? "Đang bán" : product.status === "draft" ? "Bản nháp" : "Đã ẩn"}</span>
              </span>
              <span className="product-editor-open-label">Quản lý sản phẩm <span aria-hidden="true">↗</span></span>
            </button>
            {mode !== "food" && <Link className="product-variants-link" href={`/dashboard/menu/${product.id}/variants`} aria-label={`Quản lý biến thể của ${product.name}`}>Biến thể</Link>}
            <form className="product-visibility-form" action={setProductVisibility}>
              <input type="hidden" name="product_id" value={product.id} />
              <input type="hidden" name="status" value={product.status === "active" ? "archived" : "active"} />
              <ProductVisibilityButton name={product.name} active={product.status === "active"} />
            </form>
          </article>
        ))}
        {!products.length && <div className="empty-row">Chưa có sản phẩm nào. Thêm sản phẩm đầu tiên ở biểu mẫu bên trên.</div>}
      </div>

      {selectedProduct && (
        <div className="manage-product-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeModal();
        }}>
          <section ref={modalRef} className="manage-product-modal" role="dialog" aria-modal="true" aria-labelledby="manage-product-title">
            <header className="manage-product-modal-header">
              <div>
                <span className="dashboard-kicker">QUẢN LÝ SẢN PHẨM</span>
                <h2 id="manage-product-title">{selectedProduct.name}</h2>
                <p>{formatPrice(selectedProduct.price_vnd)} · {selectedProduct.optionGroups.length} nhóm tùy chọn</p>
              </div>
              <button ref={closeButtonRef} className="dialog-close" type="button" onClick={closeModal} aria-label="Đóng cửa sổ quản lý sản phẩm">×</button>
            </header>
            <div className="manage-product-modal-content">
              <section className="dashboard-card manage-product-edit-card">
                <div className="dashboard-card-heading">
                  <div><span className="card-number">01</span><h3>Thông tin sản phẩm</h3></div>
                  <p>Cập nhật tên, giá, tồn kho và trạng thái.</p>
                </div>
                <ProductForm
                  mode={mode}
                  showLowStockThreshold={showLowStockThreshold}
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
                    low_stock_threshold: selectedProduct.low_stock_threshold,
                  }}
                />
              </section>
              <ProductOptionsManager mode={mode} productId={selectedProduct.id} groups={selectedProduct.optionGroups} />
              {mode !== "food" && <Link className="secondary-submit" href={`/dashboard/menu/${selectedProduct.id}/variants`}>Quản lý biến thể sản phẩm →</Link>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
