import Image from "next/image";
import Link from "next/link";
import { blockCompatible, findThemeHome, themeBlocks, themeImagePublicUrl, themePageInNavigation, themePageTemplate, type ThemeBlock, type ThemePage } from "@/lib/theme-pages";
import type { StorefrontData } from "./storefront-client";

type Props = Pick<StorefrontData, "products" | "categories" | "reviews"> & {
  store: Pick<StorefrontData["store"], "name" | "description" | "phone" | "address">;
  pages: ThemePage[]; page?: ThemePage; family?: string; base: string;
};
export type BlockData = {
  store: Props["store"];
  products: Pick<Props["products"][number], "id" | "name" | "price" | "image">[];
  categories: Pick<Props["categories"][number], "id" | "name">[];
  reviews: Pick<Props["reviews"][number], "id" | "displayName" | "rating" | "body">[];
};

export function ThemeBlockImage({ image }: { image?: string }) {
  const url = themeImagePublicUrl(image);
  return url ? <Image className="theme-content-image" src={url} alt="" width={1200} height={720} unoptimized /> : null;
}

export function ThemeBlockContent({ block, data, productHref, categoryHref }: {
  block: ThemeBlock;
  data: BlockData;
  productHref?: (id: string) => string;
  categoryHref?: (id: string) => string;
}) {
  const { store, products, categories, reviews } = data;
  const source = themeBlocks[block.kind].source;
  return <>
    <h2>{block.title || themeBlocks[block.kind].label}</h2>
    {block.copy && <p>{block.copy}</p>}
    <ThemeBlockImage image={block.image} />
    {source === "store" && (block.kind === "contact" ? <address>{store.address && <p>{store.address}</p>}{store.phone && (productHref ? <a href={`tel:${store.phone}`}>{store.phone}</a> : <span>{store.phone}</span>)}{!store.address && !store.phone && <p>Chưa có thông tin liên hệ.</p>}</address> : store.description && <p>{store.description}</p>)}
    {source === "catalog" && (products.length ? <ul className="published-theme-grid">{products.slice(0, block.limit).map(product => {
      const item = <>{product.image && <Image src={product.image} alt="" width={240} height={150} unoptimized />}<strong>{product.name}</strong><span>{product.price.toLocaleString("vi-VN")} ₫</span></>;
      return <li key={product.id}>{productHref ? <Link href={productHref(product.id)}>{item}</Link> : <div className="theme-preview-product">{item}</div>}</li>;
    })}</ul> : <p>Chưa có sản phẩm để hiển thị.</p>)}
    {source === "categories" && (categories.length ? <ul className="published-theme-grid">{categories.slice(0,block.limit).map(category =>
      <li key={category.id}>{categoryHref ? <Link href={categoryHref(category.id)}>{category.name}</Link> : category.name}</li>)}</ul> : <p>Chưa có danh mục để hiển thị.</p>)}
    {source === "reviews" && (reviews.length ? <ul>{reviews.slice(0,block.limit).map(review =>
      <li key={review.id}><strong>{review.displayName} · {review.rating}/5</strong><p>{review.body}</p></li>)}</ul> : <p>Chưa có đánh giá.</p>)}
  </>;
}

export default function ThemeSections({ store, products, categories, reviews, pages, page, family, base }: Props) {
  const home = base || "/";
  const href = (kind: string, query: string, fallback: string) =>
    pages.some(value => value.kind === kind && value.visible) ? `${base}/pages/${kind}?${query}` : `${home}#${fallback}`;
  const homeId = findThemeHome(pages)?.id;
  const nav = pages.filter(item => item.id !== homeId && themePageInNavigation(item));
  return <div className="published-theme-sections" data-page-template={page ? themePageTemplate(page) : undefined}>
    {nav.length > 0 && <nav aria-label="Trang cửa hàng"><Link href={home}>Trang chủ</Link>{nav.map(item => <Link key={item.id} href={`${base}/pages/${item.slug}`}>{item.title}</Link>)}</nav>}
    {page && page.kind !== "home" && <h1>{page.title}</h1>}
    {page?.blocks.filter(block => !block.hidden && blockCompatible(block.kind, family)).map(block =>
      <section key={block.id} className="published-theme-block">
        <ThemeBlockContent block={block} data={{ store, products, categories, reviews }}
          productHref={id => href("product", new URLSearchParams({ product: id }).toString(), "top")}
          categoryHref={id => href("category", new URLSearchParams({ category: id }).toString(), "top")} />
      </section>)}
  </div>;
}
