"use client";
import { useRef } from "react";
import CategoryForm from "./category-form";
import ProductForm from "./product-form";
import type { MerchandiseMode } from "@/lib/merchandise-mode";
import "./create-catalog-dialogs.css";
export default function CreateCatalogDialogs({ storeId, categories, brands, imagesAvailable, showLowStockThreshold, mode }: { storeId:string; categories:{id:string;name:string}[]; brands:{id:string;name:string}[]; imagesAvailable:boolean; showLowStockThreshold:boolean; mode:MerchandiseMode }) {
  const categoryDialog = useRef<HTMLDialogElement>(null), productDialog = useRef<HTMLDialogElement>(null);
  const productName = mode === "food" ? "món ăn" : "sản phẩm";
  return <><button type="button" className="catalog-open-secondary" onClick={() => categoryDialog.current?.showModal()}>＋ Thêm danh mục</button><button type="button" className="catalog-open-primary" onClick={() => productDialog.current?.showModal()}>＋ {mode === "food" ? "Thêm món" : "Thêm sản phẩm"}</button>
    <dialog ref={categoryDialog} className="catalog-dialog" aria-labelledby="create-category-title" onClick={(event) => { if (event.target === event.currentTarget) categoryDialog.current?.close(); }}><div className="catalog-dialog-header"><div><small>DANH MỤC</small><h2 id="create-category-title">Thêm danh mục</h2><p>Nhóm sản phẩm để khách hàng dễ tìm kiếm.</p></div><button type="button" className="catalog-dialog-close" aria-label="Đóng" onClick={() => categoryDialog.current?.close()}>×</button></div><div className="catalog-dialog-content"><CategoryForm storeId={storeId} imagesAvailable={imagesAvailable} /></div></dialog>
    <dialog ref={productDialog} className="catalog-dialog catalog-dialog-product" aria-labelledby="create-product-title" onClick={(event) => { if (event.target === event.currentTarget) productDialog.current?.close(); }}><div className="catalog-dialog-header"><div><small>QUẢN LÝ CỬA HÀNG</small><h2 id="create-product-title">Thêm {productName}</h2><p>Điền thông tin để tạo {productName} mới.</p></div><button type="button" className="catalog-dialog-close" aria-label="Đóng" onClick={() => productDialog.current?.close()}>×</button></div><div className="catalog-dialog-content"><ProductForm mode={mode} storeId={storeId} categories={categories} brands={brands} showLowStockThreshold={showLowStockThreshold} /></div></dialog>
  </>;
}
