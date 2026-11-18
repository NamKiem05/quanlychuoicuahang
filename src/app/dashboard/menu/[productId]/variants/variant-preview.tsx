"use client";
import { useMemo, useState } from "react";
type Variant = { id: string; attributes: Record<string, string>; price: number; stock: number };
type PreviewLine = { id: string; attributes: Record<string, string>; price: number; quantity: number };
const money = (value: number) => `${value.toLocaleString("vi-VN")}₫`;
export default function VariantPreview({ variants }: { variants: Variant[] }) {
  const [chosen, setChosen] = useState<Record<string,string>>({});
  const [cart, setCart] = useState<PreviewLine[]>([]);
  const groups = useMemo(() => {
    const values = new Map<string, Set<string>>();
    for (const variant of variants) for (const [name, value] of Object.entries(variant.attributes)) { if (!values.has(name)) values.set(name, new Set()); values.get(name)!.add(value); }
    return [...values].map(([name, options]) => ({ name, options: [...options] }));
  }, [variants]);
  const match = variants.find((variant) => groups.every(({name}) => chosen[name] && variant.attributes[name] === chosen[name]) && Object.keys(variant.attributes).length === groups.length);
  const selectedQuantity = match ? cart.find((item) => item.id === match.id)?.quantity ?? 0 : 0;
  function changeQuantity(id: string, change: number) {
    const variant = variants.find((item) => item.id === id);
    if (!variant) return;
    setCart((current) => current.map((item) => item.id === id ? { ...item, quantity: Math.max(0, Math.min(variant.stock, item.quantity + change)) } : item).filter((item) => item.quantity > 0));
  }
  function add() {
    if (!match || match.stock < 1) return;
    setCart((previous) => {
      const line = previous.find((item) => item.id === match.id);
      if (line && line.quantity >= match.stock) return previous;
      return line ? previous.map((item) => item.id === match.id ? { ...item, quantity: item.quantity + 1 } : item) : [...previous, { id: match.id, attributes: match.attributes, price: match.price, quantity: 1 }];
    });
  }
  if (!variants.length) return null;
  return <section className="variants-card variant-preview"><div className="variant-preview-heading"><div><h2>Xem trước chọn biến thể</h2><p>Chỉ hiển thị trong trang quản lý. Giỏ hàng dưới đây dùng để xem trước và không tạo đơn hàng.</p></div><span>THỬ NGHIỆM</span></div>{groups.map(({name,options}) => <fieldset key={name}><legend>{name}</legend><div>{options.map((value) => <button type="button" key={value} className={chosen[name] === value ? "is-selected" : ""} aria-pressed={chosen[name] === value} onClick={() => setChosen(current => ({ ...current, [name]: value }))}>{value}</button>)}</div></fieldset>)}<div className="variant-preview-result" aria-live="polite">{match ? <><strong>{money(match.price)}</strong><span>{match.stock ? `Còn ${match.stock} sản phẩm` : "Hết hàng"}</span>{selectedQuantity > 0 && <span>Đã chọn {selectedQuantity}</span>}</> : <span>{groups.every(({name}) => chosen[name]) ? "Tổ hợp này không có sẵn." : "Chọn đủ thuộc tính để xem giá và số lượng."}</span>}</div><button type="button" className="variant-preview-add" disabled={!match || selectedQuantity >= match.stock} onClick={add}>Thêm vào giỏ xem trước</button>{cart.length > 0 && <div className="variant-preview-cart"><h3>Giỏ xem trước</h3>{cart.map((item) => <div key={item.id}><span>{Object.entries(item.attributes).map(([key,value])=>`${key}: ${value}`).join(" · ")}</span><div className="variant-preview-quantity"><button type="button" aria-label="Giảm số lượng" onClick={() => changeQuantity(item.id, -1)}>−</button><output aria-label="Số lượng">{item.quantity}</output><button type="button" aria-label="Tăng số lượng" disabled={item.quantity >= (variants.find((variant) => variant.id === item.id)?.stock ?? 0)} onClick={() => changeQuantity(item.id, 1)}>+</button></div><b>{money(item.price * item.quantity)}</b><button type="button" aria-label="Xóa khỏi giỏ xem trước" onClick={() => setCart(current => current.filter((line) => line.id !== item.id))}>×</button></div>)}<p>Tạm tính: <b>{money(cart.reduce((sum,item)=>sum+item.price*item.quantity,0))}</b></p></div>}</section>;
}
