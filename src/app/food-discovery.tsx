"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type NearbyStore = {
  id: string;
  name: string;
  slug: string;
  description: string;
  phone: string | null;
  address: string | null;
  logo_url: string | null;
  banner_url: string | null;
  distance_m: number;
  accepts_orders: boolean;
};

type NearbyProduct = {
  id: string;
  name: string;
  description: string;
  price_vnd: number;
  image_url: string | null;
  category: string;
  store_name: string;
  store_slug: string;
  distance_m: number;
  rating: number | null;
  review_count: number;
  created_at: string;
};

const commonCategories = [
  { name: "Pizza", icon: "🍕" },
  { name: "Burger", icon: "🍔" },
  { name: "Cơm", icon: "🍛" },
  { name: "Phở", icon: "🍜" },
  { name: "Bún", icon: "🥗" },
  { name: "Lẩu", icon: "🍲" },
  { name: "Ăn vặt", icon: "🍟" },
  { name: "Bánh ngọt", icon: "🍰" },
  { name: "Đồ uống", icon: "🧋" },
];

function categoryIcon(name: string) {
  const value = name.toLocaleLowerCase("vi-VN");
  if (value.includes("pizza")) return "🍕";
  if (value.includes("burger") || value.includes("hamburger")) return "🍔";
  if (value.includes("cơm")) return "🍛";
  if (value.includes("phở") || value.includes("mì")) return "🍜";
  if (value.includes("bún")) return "🥗";
  if (value.includes("lẩu")) return "🍲";
  if (value.includes("bánh")) return "🍰";
  if (value.includes("uống") || value.includes("nước")) return "🧋";
  if (value.includes("ăn vặt") || value.includes("snack")) return "🍟";
  return "🍽️";
}

function formatPrice(price: number) {
  return Number(price).toLocaleString("vi-VN") + "₫";
}

function formatDistance(distance: number) {
  return distance < 1000 ? distance + " m" : (distance / 1000).toFixed(1) + " km";
}

export default function FoodDiscovery() {
  const supabase = useMemo(() => createClient(), []);
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [products, setProducts] = useState<NearbyProduct[]>([]);
  const [categoryNames, setCategoryNames] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("Tất cả");
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [message, setMessage] = useState("");

  const categories = categoryNames.length
    ? categoryNames.map((name) => ({ name, icon: categoryIcon(name) }))
    : commonCategories;
  const filteredProducts = products.filter((product) => {
    const query = search.trim().toLocaleLowerCase("vi-VN");
    const matchesSearch = !query || [product.name, product.store_name, product.category]
      .some((value) => value.toLocaleLowerCase("vi-VN").includes(query));
    const matchesCategory = activeCategory === "Tất cả" || product.category === activeCategory;
    return matchesSearch && matchesCategory;
  });
  const visibleProducts = showAll ? filteredProducts : filteredProducts.slice(0, 6);

  async function loadNearbyCatalog(latitude: number, longitude: number) {
    const { data: nearbyRows, error: nearbyError } = await supabase.rpc("find_nearby_stores", {
      requested_lat: latitude,
      requested_lon: longitude,
    });
    if (nearbyError) throw nearbyError;

    const nearbyStores = (nearbyRows ?? []) as Omit<NearbyStore, "accepts_orders">[];
    if (!nearbyStores.length) {
      setStores([]);
      setProducts([]);
      setCategoryNames([]);
      return;
    }

    const storeIds = nearbyStores.map((store) => store.id);
    const { data: orderSettings, error: settingsError } = await supabase
      .from("stores")
      .select("id, accepts_orders")
      .in("id", storeIds);
    if (settingsError) throw settingsError;
    const acceptanceByStore = new Map((orderSettings || []).map((store) => [store.id, store.accepts_orders]));
    const storesWithStatus = nearbyStores.map((store) => ({
      ...store,
      accepts_orders: acceptanceByStore.get(store.id) ?? true,
    }));
    setStores(storesWithStatus);
    const orderableStores = storesWithStatus.filter((store) => store.accepts_orders);
    if (!orderableStores.length) {
      setProducts([]);
      setCategoryNames([]);
      return;
    }

    const orderableStoreIds = orderableStores.map((store) => store.id);
    const [{ data: productRows, error: productError }, { data: categoryRows, error: categoryError }] = await Promise.all([
      supabase
        .from("products")
        .select("id, store_id, category_id, name, description, price_vnd, image_url, created_at")
        .in("store_id", orderableStoreIds)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(60),
      supabase
        .from("categories")
        .select("id, name, sort_order")
        .in("store_id", orderableStoreIds)
        .eq("is_active", true)
        .order("sort_order"),
    ]);
    if (productError || categoryError) throw productError || categoryError;

    const categoryById = new Map((categoryRows || []).map((category) => [category.id, category.name]));
    const storeById = new Map(orderableStores.map((store) => [store.id, store]));
    const rowsForRatings = productRows || [];
    const productIds = rowsForRatings.map((product) => product.id);
    const { data: reviewRows, error: reviewError } = productIds.length
      ? await supabase
          .from("reviews")
          .select("product_id, rating")
          .eq("status", "published")
          .in("product_id", productIds)
      : { data: [], error: null };
    if (reviewError) throw reviewError;

    const reviewSummary = new Map<string, { total: number; count: number }>();
    for (const review of reviewRows || []) {
      if (!review.product_id) continue;
      const summary = reviewSummary.get(review.product_id) || { total: 0, count: 0 };
      summary.total += review.rating;
      summary.count += 1;
      reviewSummary.set(review.product_id, summary);
    }

    setCategoryNames(Array.from(new Set((categoryRows || []).map((category) => category.name))));
    setProducts(rowsForRatings.flatMap((product) => {
      const store = storeById.get(product.store_id);
      if (!store) return [];
      const summary = reviewSummary.get(product.id);
      return [{
        id: product.id,
        name: product.name,
        description: product.description,
        price_vnd: Number(product.price_vnd),
        image_url: product.image_url,
        category: product.category_id ? categoryById.get(product.category_id) || "Chưa phân loại" : "Chưa phân loại",
        store_name: store.name,
        store_slug: store.slug,
        distance_m: store.distance_m,
        rating: summary ? summary.total / summary.count : null,
        review_count: summary ? summary.count : 0,
        created_at: product.created_at,
      }];
    }));
  }

  function findNearbyStores() {
    setMessage("");
    if (!navigator.geolocation) {
      setMessage("Trình duyệt này chưa hỗ trợ chia sẻ vị trí. Hãy thử trình duyệt khác.");
      return;
    }

    setIsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          await loadNearbyCatalog(coords.latitude, coords.longitude);
          setHasSearched(true);
          setActiveCategory("Tất cả");
          setShowAll(false);
        } catch {
          setStores([]);
          setProducts([]);
          setCategoryNames([]);
          setMessage("Chưa tải được cửa hàng gần bạn. Hãy thử lại sau.");
        } finally {
          setIsLoading(false);
        }
      },
      () => {
        setIsLoading(false);
        setMessage("Không lấy được vị trí. Bạn có thể cho phép truy cập vị trí rồi thử lại.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  return (
    <main className="food-home">
      <header className="food-header">
        <a className="brand food-brand" href="/" aria-label="Gần Đây - trang chủ">
          <span className="brand-mark">G</span>
          <span><b>gần đây<span>.</span></b><small>Món ngon quanh bạn</small></span>
        </a>
        <label className="food-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder="Tìm món ăn, cửa hàng..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Tìm món ăn hoặc cửa hàng"
          />
        </label>
        <nav className="food-nav" aria-label="Điều hướng chính">
          <a className="food-nav-active" href="/">⌂ <span>Trang chủ</span></a>
          <a href="#categories">▦ <span>Danh mục</span></a>
          <a href="#promotions">◇ <span>Tiện ích</span></a>
          <a href="#nearby">⌂ <span>Nhà hàng</span></a>
          <a href="/track-order">↗ <span>Tra cứu đơn</span></a>
        </nav>
        <a className="food-owner-link" href="/login">Chủ quán</a>
      </header>

      <section className="food-hero">
        <div className="food-hero-copy">
          <div className="food-hero-kicker">MÓN NGON QUANH NHÀ</div>
          <h1>Đồ ăn ngon,<br /><em>ngay gần bạn</em></h1>
          <div className="food-hero-points">
            <span>✓ Trong 5 km</span><span>✓ Đặt trực tiếp</span><span>✓ Theo dõi đơn</span>
          </div>
          <a className="food-hero-button" href="#nearby">Tìm cửa hàng <span>→</span></a>
        </div>
        <div className="food-hero-note"><span>✳</span><b>Ngon mỗi ngày</b><small>Từ các cửa hàng địa phương</small></div>
      </section>

      <section className="food-categories" id="categories" aria-labelledby="food-category-heading">
        <div className="food-section-heading">
          <div><span className="food-section-kicker">CHỌN THEO SỞ THÍCH</span><h2 id="food-category-heading">Danh mục món ăn</h2></div>
          <span className="food-section-hint">Chia sẻ vị trí để xem món có trong khu vực của bạn</span>
        </div>
        <div className="food-category-list">
          <button className={"food-category-card" + (activeCategory === "Tất cả" ? " selected" : "")} type="button" onClick={() => setActiveCategory("Tất cả")}>
            <span>🍽️</span><b>Tất cả</b>
          </button>
          {categories.map((category) => (
            <button className={"food-category-card" + (activeCategory === category.name ? " selected" : "")} type="button" key={category.name} onClick={() => setActiveCategory(category.name)}>
              <span>{category.icon}</span><b>{category.name}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="food-popular" id="popular" aria-labelledby="food-popular-heading">
        <div className="food-section-heading">
          <div><span className="food-section-kicker">CỬA HÀNG ĐANG NHẬN ĐƠN GẦN BẠN</span><h2 id="food-popular-heading"><span>🔥</span> Món ngon quanh đây</h2></div>
          <button className="food-link-button" type="button" onClick={findNearbyStores} disabled={isLoading}>{isLoading ? "Đang tìm..." : "Tìm cửa hàng gần tôi →"}</button>
        </div>
        {message && <p className="location-message" role="status">{message}</p>}
        {hasSearched && products.length > 0 ? (
          <>
            {filteredProducts.length > 0 ? (
              <div className="food-product-grid">
                {visibleProducts.map((product) => (
                  <article className="food-product-card" key={product.id}>
                    <a className="food-product-photo" href={"/" + product.store_slug} style={product.image_url ? { backgroundImage: "url(\"" + product.image_url + "\")" } : undefined} aria-label={"Xem " + product.name + " tại " + product.store_name}>
                      {!product.image_url && <span>{categoryIcon(product.category)}</span>}
                      {Date.now() - new Date(product.created_at).getTime() < 14 * 24 * 60 * 60 * 1000 && <span className="food-product-badge">Mới</span>}
                    </a>
                    <div className="food-product-info">
                      <small>{product.category}</small>
                      <a className="food-product-name" href={"/" + product.store_slug}>{product.name}</a>
                      <p>{product.store_name} · {formatDistance(product.distance_m)}</p>
                      <div className="food-product-rating">
                        {product.rating ? <><span>★</span> {product.rating.toFixed(1)} <small>({product.review_count})</small></> : <small>Chưa có đánh giá</small>}
                      </div>
                      <div className="food-product-bottom">
                        <strong>{formatPrice(product.price_vnd)}</strong>
                        <a href={"/" + product.store_slug} aria-label={"Xem thực đơn " + product.store_name}>Vào quán <span>↗</span></a>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="food-empty-results"><b>Chưa tìm thấy món phù hợp</b><p>Thử từ khóa hoặc danh mục khác.</p></div>
            )}
            {filteredProducts.length > 6 && (
              <button className="food-show-more" type="button" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Thu gọn" : "Xem thêm " + (filteredProducts.length - 6) + " món"} <span>{showAll ? "↑" : "↓"}</span>
              </button>
            )}
          </>
        ) : hasSearched ? (
          <div className="food-empty-results">
            <b>{stores.length && !stores.some((store) => store.accepts_orders) ? "Các cửa hàng gần bạn đang tạm ngưng nhận đơn" : "Chưa có món đang bán ở khu vực này"}</b>
            <p>Hãy xem các cửa hàng gần bạn bên dưới hoặc thử lại sau.</p>
          </div>
        ) : (
          <div className="food-location-prompt">
            <span>⌖</span><div><b>Xem món đang bán trong bán kính 5 km</b><p>Chia sẻ vị trí để chỉ tìm món từ các cửa hàng gần bạn.</p></div>
            <button className="food-location-button" type="button" onClick={findNearbyStores} disabled={isLoading}>{isLoading ? "Đang tìm..." : "Dùng vị trí của tôi"}</button>
          </div>
        )}
      </section>

      <section className="food-promotions" id="promotions" aria-label="Thông tin dịch vụ">
        <a className="food-promo-card food-promo-nearby" href="#nearby"><span>⌖</span><div><b>Tìm quán gần nhà</b><small>Khám phá cửa hàng trong 5 km</small></div><strong>→</strong></a>
        <a className="food-promo-card food-promo-direct" href="#popular"><span>♨</span><div><b>Đặt món trực tiếp</b><small>Chọn món từ thực đơn cửa hàng</small></div><strong>→</strong></a>
        <a className="food-promo-card food-promo-track" href="/track-order"><span>✓</span><div><b>Theo dõi đơn hàng</b><small>Tra cứu bằng mã đơn của bạn</small></div><strong>→</strong></a>
      </section>

      <section className="nearby-section food-nearby-section" id="nearby" aria-labelledby="nearby-heading">
        <div className="nearby-heading">
          <div>
            <div className="eyebrow"><span>✳</span> ĂN NGON QUANH BẠN</div>
            <h2 id="nearby-heading">Cửa hàng gần bạn</h2>
            <p>{hasSearched ? "Tìm thấy " + stores.length + " cửa hàng trong bán kính 5 km." : "Khám phá cửa hàng đang hoạt động trong bán kính 5 km."}</p>
          </div>
          <button className="primary-button location-button" type="button" onClick={findNearbyStores} disabled={isLoading}>
            {isLoading ? "Đang tìm..." : hasSearched ? "Làm mới vị trí" : "Dùng vị trí của tôi"}<span>⌖</span>
          </button>
        </div>
        {stores.length > 0 ? (
          <div className="nearby-grid">
            {stores.map((store) => (
              <a className="nearby-card" href={"/" + store.slug} key={store.id}>
                <div className="nearby-card-image" style={store.banner_url ? { backgroundImage: "url(\"" + store.banner_url + "\")" } : undefined}>
                  <span className="nearby-distance">{formatDistance(store.distance_m)}</span>
                  <span className={"nearby-open-status" + (store.accepts_orders ? "" : " paused")}>{store.accepts_orders ? "Đang nhận đơn" : "Tạm nghỉ"}</span>
                </div>
                <div className="nearby-card-info">
                  <div className="nearby-store-mark">{store.name.trim().charAt(0).toUpperCase()}</div>
                  <div><b>{store.name}</b><span>{store.address || "Đang cập nhật địa chỉ"}</span></div>
                  <span className="nearby-arrow">↗</span>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="nearby-prompt">
            <span>⌖</span>
            <p>{hasSearched ? "Chưa có cửa hàng nào trong bán kính 5 km." : "Cho phép truy cập vị trí để xem các cửa hàng phục vụ khu vực của bạn."}</p>
          </div>
        )}
      </section>

      <footer className="food-footer">
        <a className="brand food-brand" href="/" aria-label="Gần Đây - trang chủ"><span className="brand-mark">G</span><span><b>gần đây<span>.</span></b><small>Món ngon quanh bạn</small></span></a>
        <span>Đặt món trực tiếp từ các cửa hàng địa phương.</span>
        <a href="/login">Dành cho chủ quán ↗</a>
        <a href="/track-order">Tra cứu đơn hàng</a>
      </footer>
    </main>
  );
}
