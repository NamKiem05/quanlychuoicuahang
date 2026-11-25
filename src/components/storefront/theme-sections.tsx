import Image from "next/image";
import Link from "next/link";
import { blockCompatible, themeBlocks, type ThemePage } from "@/lib/theme-pages";
import type { StorefrontData } from "./storefront-client";

type Props = Pick<StorefrontData, "products" | "categories" | "reviews"> & {
  store: Pick<StorefrontData["store"], "name" | "description" | "phone" | "address">;
  pages: ThemePage[]; page?: ThemePage; family?: string; base: string;
};

export default function ThemeSections({ store, products, categories, reviews, pages, page, family, base }: Props) {
  const home = base || "/";
  const href = (kind: string, query: string, fallback: string) =>
    pages.some(value => value.kind === kind && value.visible) ? `${base}/pages/${kind}?${query}` : `${home}#${fallback}`;
  const nav = pages.filter(item => item.visible && ["contact","about","custom","products","search","cart"].includes(item.kind));
  return <div className="published-theme-sections">
    {nav.length > 0 && <nav aria-label="Trang cửa hàng"><Link href={home}>Trang chủ</Link>{nav.map(item => <Link key={item.id} href={`${base}/pages/${item.slug}`}>{item.title}</Link>)}</nav>}
    {page && page.kind !== "home" && <h1>{page.title}</h1>}
    {page?.blocks.filter(block => !block.hidden && blockCompatible(block.kind, family)).map(block => {
      const source = themeBlocks[block.kind].source;
      return <section key={block.id} className="published-theme-block">
        <h2>{block.title || themeBlocks[block.kind].label}</h2>
        {block.copy && <p>{block.copy}</p>}
        {source === "store" && (block.kind === "contact" ? <address>{store.address && <p>{store.address}</p>}{store.phone && <a href={`tel:${store.phone}`}>{store.phone}</a>}{!store.address && !store.phone && <p>Chưa có thông tin liên hệ.</p>}</address> : store.description && <p>{store.description}</p>)}
        {source === "catalog" && (products.length ? <ul className="published-theme-grid">{products.slice(0, block.limit).map(product =>
          <li key={product.id}><Link href={href("product", new URLSearchParams({ product: product.id }).toString(), "top")}>
            {product.image && <Image src={product.image} alt="" width={240} height={150} unoptimized />}<strong>{product.name}</strong><span>{product.price.toLocaleString("vi-VN")} ₫</span>
          </Link></li>)}</ul> : <p>Chưa có sản phẩm để hiển thị.</p>)}
        {source === "categories" && (categories.length ? <ul className="published-theme-grid">{categories.slice(0,block.limit).map(category =>
          <li key={category.id}><Link href={href("category", new URLSearchParams({ category: category.id }).toString(), "top")}>{category.name}</Link></li>)}</ul> : <p>Chưa có danh mục để hiển thị.</p>)}
        {source === "reviews" && (reviews.length ? <ul>{reviews.slice(0,block.limit).map(review =>
          <li key={review.id}><strong>{review.displayName} · {review.rating}/5</strong><p>{review.body}</p></li>)}</ul> : <p>Chưa có đánh giá.</p>)}
      </section>;
    })}
  </div>;
}
