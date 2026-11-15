"use client";

import { useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import BankTransferQr, { type BankTransferDetails } from "@/app/bank-transfer-qr";

export type StorefrontCategory = { id: string; name: string };

export type StorefrontProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  label: string;
  image: string;
};

export type StorefrontReview = {
  id: string;
  productId: string | null;
  productName: string;
  displayName: string;
  rating: number;
  body: string;
  createdAt: string;
};

export type StorefrontData = {
  store: {
    id: string;
    name: string;
    slug: string;
    description: string;
    phone: string | null;
    address: string | null;
    logo_url: string | null;
    banner_url: string | null;
    accepts_orders: boolean;
    delivery_enabled: boolean;
    delivery_radius_m: number;
    delivery_fee_vnd: number;
    bankTransfer: null | {
      bank_code: string;
      bank_name: string;
      account_number: string;
      account_name: string;
    };
  };
  categories: StorefrontCategory[];
  products: StorefrontProduct[];
  reviews: StorefrontReview[];
};

const formatPrice = (price: number) => `${price.toLocaleString("vi-VN")}₫`;
const formatDistance = (meters: number) => `${(meters / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} km`;

type CartLine = { productId: string; quantity: number };
type ActivePanel = "cart" | "checkout" | "success" | null;
type OrderPayment = {
  method: "cash_on_pickup" | "bank_transfer";
  amount: number;
  details: BankTransferDetails | null;
};
type OrderDelivery = {
  method: "pickup" | "delivery";
  address: string | null;
  fee: number;
  distance: number | null;
};

export default function StorefrontClient({ store, categories, products, reviews }: StorefrontData) {
  const supabase = useMemo(() => createClient(), []);
  const [activeCategory, setActiveCategory] = useState("Tất cả");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [orderCode, setOrderCode] = useState("");
  const [orderEmail, setOrderEmail] = useState("");
  const [orderPhone, setOrderPhone] = useState("");
  const [emailNotificationStatus, setEmailNotificationStatus] = useState<"sending" | "sent" | "failed" | null>(null);
  const [placedOrderTotal, setPlacedOrderTotal] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"cash_on_pickup" | "bank_transfer">("cash_on_pickup");
  const [orderPayment, setOrderPayment] = useState<OrderPayment | null>(null);
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"pickup" | "delivery">("pickup");
  const [deliveryLocation, setDeliveryLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [deliveryLocationMessage, setDeliveryLocationMessage] = useState("");
  const [isLocatingDelivery, setIsLocatingDelivery] = useState(false);
  const [orderDelivery, setOrderDelivery] = useState<OrderDelivery | null>(null);
  const [orderError, setOrderError] = useState("");
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [addedProduct, setAddedProduct] = useState<string | null>(null);
  const categoryNames = [
    "Tất cả",
    ...new Set([
      ...categories.map((category) => category.name),
      ...products.map((product) => product.category),
    ]),
  ];

  const cartLines = cart.flatMap((line) => {
    const product = products.find((item) => item.id === line.productId);
    return product ? [{ ...line, product }] : [];
  });
  const cartCount = cart.reduce((count, line) => count + line.quantity, 0);
  const cartTotal = cartLines.reduce(
    (total, line) => total + line.product.price * line.quantity,
    0,
  );
  const checkoutTotal = cartTotal + (fulfillmentMethod === "delivery" ? Number(store.delivery_fee_vnd) : 0);

  const visibleProducts = useMemo(
    () =>
      products.filter((product) => {
        const matchesCategory =
          activeCategory === "Tất cả" || product.category === activeCategory;
        const matchesSearch = product.name
          .toLocaleLowerCase("vi-VN")
          .includes(search.trim().toLocaleLowerCase("vi-VN"));
        return matchesCategory && matchesSearch;
      }),
    [activeCategory, categoryNames, search],
  );
  const reviewsByProduct = useMemo(() => {
    const grouped = new Map<string, StorefrontReview[]>();
    for (const review of reviews) {
      if (!review.productId) continue;
      const productReviews = grouped.get(review.productId) ?? [];
      productReviews.push(review);
      grouped.set(review.productId, productReviews);
    }
    return grouped;
  }, [reviews]);

  function addToCart(productId: string) {
    setCart((currentCart) => {
      const existingLine = currentCart.find((line) => line.productId === productId);
      if (existingLine) {
        return currentCart.map((line) =>
          line.productId === productId
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [...currentCart, { productId, quantity: 1 }];
    });
    setAddedProduct(productId);
    window.setTimeout(() => setAddedProduct(null), 1200);
  }

  function changeQuantity(productId: string, change: number) {
    setCart((currentCart) =>
      currentCart
        .map((line) =>
          line.productId === productId
            ? { ...line, quantity: line.quantity + change }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  function requestDeliveryLocation() {
    setDeliveryLocationMessage("");
    setDeliveryLocation(null);
    if (!navigator.geolocation) {
      setDeliveryLocationMessage("Trình duyệt này chưa hỗ trợ lấy vị trí.");
      return;
    }

    setIsLocatingDelivery(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setDeliveryLocation({ latitude: coords.latitude, longitude: coords.longitude });
        setDeliveryLocationMessage("Đã ghi nhận vị trí giao hàng của bạn.");
        setIsLocatingDelivery(false);
      },
      () => {
        setDeliveryLocationMessage("Chưa lấy được vị trí. Hãy cho phép trình duyệt truy cập vị trí rồi thử lại.");
        setIsLocatingDelivery(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }

  async function sendOrderConfirmationEmail(publicCode: string, customerPhone: string) {
    setEmailNotificationStatus("sending");
    try {
      const notificationResponse = await fetch("/api/order-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicCode, customerPhone }),
      });
      const notificationResult = await notificationResponse.json().catch(() => null);
      setEmailNotificationStatus(notificationResponse.ok && notificationResult?.sent === true ? "sent" : "failed");
    } catch {
      setEmailNotificationStatus("failed");
    }
  }

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOrderError("");
    setEmailNotificationStatus(null);
    setIsSubmittingOrder(true);
    const formData = new FormData(event.currentTarget);
    const requestedPaymentMethod = String(formData.get("paymentMethod") ?? "cash_on_pickup");
    const requestedFulfillment = String(formData.get("fulfillmentMethod") ?? "pickup");
    const customerPhone = String(formData.get("customerPhone") ?? "").trim();
    const customerEmail = String(formData.get("customerEmail") ?? "").trim();
    const deliveryLatitude = String(formData.get("deliveryLatitude") ?? "");
    const deliveryLongitude = String(formData.get("deliveryLongitude") ?? "");
    if (requestedFulfillment === "delivery" && (!deliveryLatitude || !deliveryLongitude)) {
      setIsSubmittingOrder(false);
      setOrderError("Hãy lấy vị trí giao hàng trước khi gửi đơn.");
      return;
    }

    try {
      const { data, error } = await supabase.rpc("create_guest_order", {
        requested_store_slug: store.slug,
        requested_customer_name: String(formData.get("customerName") ?? "").trim(),
        requested_customer_phone: customerPhone,
        requested_customer_note: String(formData.get("customerNote") ?? "").trim(),
        requested_items: cart.map((line) => ({
          product_id: line.productId,
          quantity: line.quantity,
        })),
        requested_payment_method: requestedPaymentMethod,
        requested_fulfillment: requestedFulfillment,
        requested_delivery_address: String(formData.get("deliveryAddress") ?? "").trim(),
        requested_delivery_latitude: deliveryLatitude ? Number(deliveryLatitude) : null,
        requested_delivery_longitude: deliveryLongitude ? Number(deliveryLongitude) : null,
        requested_customer_email: customerEmail,
      });

      if (error || !data?.public_code) {
        const errorDetail = error?.message.toLowerCase() ?? "";
        setOrderError(errorDetail.includes("outside the store delivery radius")
          ? `Địa chỉ này nằm ngoài bán kính giao hàng ${formatDistance(store.delivery_radius_m)} của cửa hàng.`
          : errorDetail.includes("store delivery is unavailable")
            ? "Cửa hàng vừa tạm ngưng giao hàng hoặc chưa cài đặt vị trí. Hãy chọn nhận tại quán hoặc thử lại sau."
            : "Chưa gửi được đơn. Cửa hàng có thể vừa ngưng nhận đơn hoặc món đã thay đổi; hãy kiểm tra giỏ rồi thử lại.");
        return;
      }

      setOrderCode(data.public_code);
      setOrderEmail(customerEmail);
      setOrderPhone(customerPhone);
      setEmailNotificationStatus("sending");
      setPlacedOrderTotal(Number(data.total_vnd));
      const isBankTransfer = data.payment_method === "bank_transfer";
      setOrderPayment({
        method: isBankTransfer ? "bank_transfer" : "cash_on_pickup",
        amount: Number(data.total_vnd),
        details: isBankTransfer && data.payment_reference ? {
          bank_code: data.payment_bank_code ?? store.bankTransfer?.bank_code ?? "",
          bank_name: data.payment_bank_name ?? store.bankTransfer?.bank_name ?? "",
          account_number: data.payment_account_number ?? store.bankTransfer?.account_number ?? "",
          account_name: data.payment_account_name ?? store.bankTransfer?.account_name ?? "",
          amount: Number(data.total_vnd),
          reference: data.payment_reference,
        } : null,
      });
      setOrderDelivery({
        method: data.fulfillment === "delivery" ? "delivery" : "pickup",
        address: data.delivery_address ?? null,
        fee: Number(data.delivery_fee_vnd ?? 0),
        distance: data.delivery_distance_m == null ? null : Number(data.delivery_distance_m),
      });
      setCart([]);
      setActivePanel("success");
      void sendOrderConfirmationEmail(data.public_code, customerPhone);
    } catch {
      setOrderError("Chưa gửi được đơn. Cửa hàng có thể vừa ngưng nhận đơn hoặc món đã thay đổi; hãy kiểm tra giỏ rồi thử lại.");
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  return (
    <main>
      <div className={"announcement" + (store.accepts_orders ? "" : " announcement-paused")}>
        <span className="announcement-dot" aria-hidden="true" />
        {store.accepts_orders ? "Cửa hàng đang nhận đơn" : "Cửa hàng tạm ngưng nhận đơn"}
        <span className="announcement-right">Hiển thị trong bán kính 5 km</span>
      </div>

      <header className="site-header">
        <a className="brand" href="#top" aria-label={`${store.name} - trang chủ`}>
          <span className="brand-mark">{store.name.trim().charAt(0).toUpperCase()}</span>
          <span className="brand-name">{store.name}<span>.</span></span>
        </a>
        <nav className="main-nav" aria-label="Điều hướng chính">
          <a className="nav-active" href="#menu">Thực đơn</a>
          <a href="/track-order">Tra cứu đơn</a>
          <a href="#story">Về bếp Mơ</a>
          <a href="#footer">Liên hệ</a>
        </nav>
        <button className="cart-button" type="button" onClick={() => setActivePanel("cart")} aria-label={`Giỏ hàng, ${cartCount} món`}>
          <span aria-hidden="true">▣</span>
          <span className="cart-label">Giỏ hàng</span>
          <span className="cart-count">{cartCount}</span>
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span>✳</span> MÓN NGON NHÀ LÀM</div>
          <h1>Ngon như cơm nhà,<br /><em>ấm lòng mỗi bữa.</em></h1>
          <p>{store.description || "Món ngon được chuẩn bị tươi mỗi ngày, đặt trực tiếp từ cửa hàng."}</p>
          <div className="hero-actions">
            <a className="primary-button" href="#menu">Khám phá thực đơn <span>↘</span></a>
            <span className="hero-note">Thực đơn cập nhật trực tiếp từ cửa hàng</span>
          </div>
          <div className="hero-details">
            <div><span className="detail-icon">⌂</span><span><b>{store.address || "Cửa hàng địa phương"}</b><small>Hiển thị trong 5 km</small></span></div>
            <div><span className="detail-icon">♡</span><span><b>Nấu trong ngày</b><small>Tươi ngon mỗi bữa</small></span></div>
          </div>
        </div>
        <div className="hero-image" role="img" aria-label={`Cửa hàng ${store.name}`} style={store.banner_url ? { backgroundImage: `linear-gradient(0deg,#18241622,#18241600 40%), url("${store.banner_url}")` } : undefined}>
          <div className="image-caption"><span className="caption-spark">✳</span><span><b>{store.name}</b><small>Món ngon từ cửa hàng</small></span></div>
          <div className="hero-stamp"><span>NHÀ LÀM</span><b>♡</b><span>TỪ 2021</span></div>
        </div>
        <span className="hero-scribble" aria-hidden="true">mời bạn ăn nhé!</span>
      </section>

      <section className="menu-section" id="menu">
        <div className="section-heading">
          <div>
            <div className="eyebrow"><span>✳</span> BẾP MƠ HÔM NAY</div>
            <h2>Món ngon chờ bạn</h2>
          </div>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="Tìm món bạn thích..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Tìm món ăn"
            />
            <kbd>⌘ K</kbd>
          </label>
        </div>

        <div className="menu-toolbar">
          <div className="category-list" aria-label="Lọc theo danh mục">
            {categoryNames.map((category) => (
              <button
                className={`category-chip${activeCategory === category ? " selected" : ""}`}
                key={category}
                onClick={() => setActiveCategory(category)}
                aria-pressed={activeCategory === category}
                type="button"
              >
                {category}
              </button>
            ))}
          </div>
          <button className="sort-button" type="button">Phổ biến nhất <span>⌄</span></button>
        </div>

        {visibleProducts.length > 0 ? (
          <div className="product-grid">
            {visibleProducts.map((product) => {
              const productReviews = reviewsByProduct.get(product.id) ?? [];
              const average = productReviews.length
                ? productReviews.reduce((sum, review) => sum + review.rating, 0) / productReviews.length
                : 0;

              return (
                <article className="product-card" key={product.id}>
                  <div className="product-image" style={{ backgroundImage: `url("${product.image}")` }}>
                    {product.label && <span className={`product-label${product.label === "Mới" ? " new-label" : ""}`}>{product.label === "Bán chạy" ? "★ " : "✳ "}{product.label}</span>}
                    <button className="favorite-button" type="button" aria-label={`Yêu thích ${product.name}`}>♡</button>
                  </div>
                  <div className="product-info">
                    <div className="product-category">{product.category}</div>
                    <h3>{product.name}</h3>
                    <p>{product.description}</p>
                    {productReviews.length > 0 && <div className="product-rating"><span>★</span> {average.toFixed(1)} <small>({productReviews.length} đánh giá)</small></div>}
                    <div className="product-bottom">
                      <strong>{formatPrice(product.price)}</strong>
                      <button className={`add-button${addedProduct === product.id ? " added" : ""}`} onClick={() => addToCart(product.id)} type="button" disabled={!store.accepts_orders} aria-label={store.accepts_orders ? `Thêm ${product.name} vào giỏ` : "Cửa hàng tạm ngưng nhận đơn"}>
                        {!store.accepts_orders ? "–" : addedProduct === product.id ? "✓" : "+"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state"><span>☻</span><b>Chưa tìm thấy món phù hợp</b><p>Thử tìm tên món khác hoặc chọn danh mục khác nhé.</p></div>
        )}
        <div className="menu-footer"><span>✳</span> Thực đơn từ {store.name}, cập nhật trực tiếp từ cửa hàng <span>✳</span></div>
      </section>

      <section className="reviews-section" id="reviews">
        <div className="reviews-heading">
          <div><div className="eyebrow"><span>✳</span> LỜI NHẮN TỪ KHÁCH</div><h2>Đánh giá món ăn</h2></div>
          <p>Đánh giá đã được cửa hàng duyệt</p>
        </div>
        {reviews.length > 0 ? (
          <div className="review-grid">
            {reviews.slice(0, 12).map((review) => (
              <article className="public-review-card" key={review.id}>
                <div className="public-review-stars" aria-label={`${review.rating} trên 5 sao`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div>
                <b>{review.productName}</b>
                {review.body && <p>{review.body}</p>}
                <footer><span>{review.displayName}</span><time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</time></footer>
              </article>
            ))}
          </div>
        ) : (
          <div className="reviews-empty">Cửa hàng chưa có đánh giá được công khai.</div>
        )}
      </section>

      <section className="story-strip" id="story">
        <span className="story-mark">M</span>
        <div><b>Món ngon địa phương, đặt trực tiếp từ cửa hàng.</b><p>{store.description || `Khám phá thực đơn của ${store.name}.`}</p></div>
        <a href="#menu">Chọn món yêu thích <span>↗</span></a>
      </section>

      <footer id="footer">
        <a className="brand footer-brand" href="#top"><span className="brand-mark">{store.name.trim().charAt(0).toUpperCase()}</span><span className="brand-name">{store.name}<span>.</span></span></a>
        <span>© 2026 {store.name}</span>
        <a href="/track-order">Tra cứu đơn hàng</a>
        <a className="owner-footer-link" href="/login">Dành cho chủ quán ↗</a>
        {store.phone && <span>Hotline <b>{store.phone}</b></span>}
      </footer>

      {cartCount > 0 && <button className="mobile-cart" type="button" onClick={() => setActivePanel("cart")}><span>▣ Giỏ hàng</span><b>{cartCount} món</b></button>}

      {activePanel && (
        <div className="dialog-backdrop" onMouseDown={() => setActivePanel(null)}>
          <section
            className={`order-dialog ${activePanel === "cart" ? "cart-dialog" : "checkout-dialog"}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <div>
                <div className="eyebrow"><span>✳</span> {store.name.toLocaleUpperCase("vi-VN")}</div>
                <h2 id="dialog-title">
                  {activePanel === "cart" && "Giỏ hàng của bạn"}
                  {activePanel === "checkout" && "Thông tin đặt món"}
                  {activePanel === "success" && "Đơn hàng đã gửi"}
                </h2>
              </div>
              <button className="dialog-close" type="button" onClick={() => setActivePanel(null)} aria-label="Đóng">×</button>
            </div>

            {activePanel === "cart" && (
              <>
                {cartLines.length > 0 ? (
                  <div className="cart-lines">
                    {cartLines.map(({ product, quantity }) => (
                      <article className="cart-line" key={product.id}>
                        <div className="cart-thumb" style={{ backgroundImage: `url("${product.image}")` }} />
                        <div className="cart-line-info">
                          <b>{product.name}</b>
                          <span>{formatPrice(product.price)}</span>
                          <div className="quantity-control">
                            <button type="button" onClick={() => changeQuantity(product.id, -1)} aria-label={`Giảm ${product.name}`}>−</button>
                            <span>{quantity}</span>
                            <button type="button" onClick={() => changeQuantity(product.id, 1)} aria-label={`Tăng ${product.name}`}>+</button>
                          </div>
                        </div>
                        <strong className="line-total">{formatPrice(product.price * quantity)}</strong>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="cart-empty"><span>▣</span><b>Giỏ hàng đang trống</b><p>Chọn vài món ngon để {store.name} chuẩn bị nhé.</p><button type="button" onClick={() => { setActivePanel(null); document.querySelector("#menu")?.scrollIntoView({ behavior: "smooth" }); }}>Xem thực đơn</button></div>
                )}
                {cartLines.length > 0 && (
                  <div className="cart-summary">
                    <div><span>Tạm tính</span><strong>{formatPrice(cartTotal)}</strong></div>
          <small>Phí giao hàng sẽ hiện ở bước tiếp theo nếu bạn chọn giao tận nơi.</small>
                    <button className="primary-button checkout-button" type="button" onClick={() => setActivePanel("checkout")}>Tiếp tục đặt món <span>→</span></button>
                  </div>
                )}
              </>
            )}

            {activePanel === "checkout" && (
              <form className="checkout-form" onSubmit={placeOrder}>
                <div className="pickup-note"><span>{fulfillmentMethod === "delivery" ? "⌖" : "⌂"}</span><div><b>{fulfillmentMethod === "delivery" ? "Giao tận nơi" : "Nhận tại cửa hàng"}</b><small>{fulfillmentMethod === "delivery" ? `Cửa hàng giao trong bán kính ${formatDistance(store.delivery_radius_m)}.` : `${store.name} sẽ xác nhận đơn và thời gian nhận món.`}</small></div></div>
                <label>Họ và tên<input name="customerName" autoComplete="name" placeholder="Tên người nhận" required /></label>
                <label>Số điện thoại<input name="customerPhone" type="tel" autoComplete="tel" inputMode="tel" pattern="[0-9+() .-]{9,16}" placeholder="Ví dụ: 090 123 4567" required /></label>
                <label>Email nhận mã đơn<input name="customerEmail" type="email" autoComplete="email" maxLength={254} placeholder="ban@example.com" required /></label>
                <fieldset className="payment-method-options fulfillment-options">
                  <legend>Cách nhận món</legend>
                  <label className={fulfillmentMethod === "pickup" ? "payment-method-option selected" : "payment-method-option"}>
                    <input type="radio" name="fulfillmentMethod" value="pickup" checked={fulfillmentMethod === "pickup"} onChange={() => setFulfillmentMethod("pickup")} />
                    <span><b>Nhận tại cửa hàng</b><small>Không tính phí giao hàng.</small></span>
                  </label>
                  {store.delivery_enabled && (
                    <label className={fulfillmentMethod === "delivery" ? "payment-method-option selected" : "payment-method-option"}>
                      <input type="radio" name="fulfillmentMethod" value="delivery" checked={fulfillmentMethod === "delivery"} onChange={() => setFulfillmentMethod("delivery")} />
                      <span><b>Giao tận nơi · {formatPrice(store.delivery_fee_vnd)}</b><small>Bán kính tối đa {formatDistance(store.delivery_radius_m)}, tính theo khoảng cách đường chim bay.</small></span>
                    </label>
                  )}
                </fieldset>
                {fulfillmentMethod === "delivery" && (
                  <div className="delivery-address-fields">
                    <label>Địa chỉ giao hàng<textarea name="deliveryAddress" rows={2} minLength={5} maxLength={500} required placeholder="Số nhà, đường, phường/xã, quận/huyện" /></label>
                    <button className="delivery-location-button" type="button" onClick={requestDeliveryLocation} disabled={isLocatingDelivery}>
                      {isLocatingDelivery ? "Đang xác định vị trí..." : deliveryLocation ? "Cập nhật vị trí giao hàng" : "Dùng vị trí hiện tại"}
                    </button>
                    {deliveryLocation && <small className="delivery-coordinates">Đã lấy tọa độ giao hàng.</small>}
                    {deliveryLocationMessage && <p className="delivery-location-message" role="status">{deliveryLocationMessage}</p>}
                    <input type="hidden" name="deliveryLatitude" value={deliveryLocation?.latitude ?? ""} />
                    <input type="hidden" name="deliveryLongitude" value={deliveryLocation?.longitude ?? ""} />
                    <p className="dashboard-help">Hãy cho phép trình duyệt truy cập vị trí tại điểm nhận hàng. Chúng tôi sẽ kiểm tra bán kính trước khi xác nhận đơn.</p>
                  </div>
                )}
                <label>Ghi chú cho quán <span className="optional-label">Không bắt buộc</span><textarea name="customerNote" rows={3} maxLength={500} placeholder="Ít cay, để riêng nước sốt..." /></label>
                <fieldset className="payment-method-options">
                  <legend>Phương thức thanh toán</legend>
                  <label className={paymentMethod === "cash_on_pickup" ? "payment-method-option selected" : "payment-method-option"}>
                    <input type="radio" name="paymentMethod" value="cash_on_pickup" checked={paymentMethod === "cash_on_pickup"} onChange={() => setPaymentMethod("cash_on_pickup")} />
                    <span><b>{fulfillmentMethod === "delivery" ? "Tiền mặt khi nhận hàng" : "Tiền mặt khi nhận món"}</b><small>{fulfillmentMethod === "delivery" ? "Thanh toán trực tiếp với người giao hàng." : "Thanh toán trực tiếp tại cửa hàng."}</small></span>
                  </label>
                  {store.bankTransfer && (
                    <label className={paymentMethod === "bank_transfer" ? "payment-method-option selected" : "payment-method-option"}>
                      <input type="radio" name="paymentMethod" value="bank_transfer" checked={paymentMethod === "bank_transfer"} onChange={() => setPaymentMethod("bank_transfer")} />
                      <span><b>Chuyển khoản QR</b><small>Quét mã QR theo số tiền và nội dung của đơn.</small></span>
                    </label>
                  )}
                </fieldset>
                {orderError && <p className="order-error" role="alert">{orderError}</p>}
                <div className="checkout-total"><span>Tạm tính · {cartCount} món</span><strong>{formatPrice(cartTotal)}</strong></div>
                {fulfillmentMethod === "delivery" && <div className="checkout-total delivery-fee-row"><span>Phí giao hàng</span><strong>{formatPrice(store.delivery_fee_vnd)}</strong></div>}
                <div className="checkout-total grand-total"><span>Tổng thanh toán</span><strong>{formatPrice(checkoutTotal)}</strong></div>
                <button className="primary-button checkout-button" type="submit" disabled={!store.accepts_orders || isSubmittingOrder}>{isSubmittingOrder ? "Đang gửi đơn..." : "Đặt món và tạo đơn"}<span>→</span></button>
                <p className="payment-note">{fulfillmentMethod === "delivery" ? "Cửa hàng tự giao đơn đến địa chỉ của bạn." : "Nhận món tại cửa hàng."} · {paymentMethod === "bank_transfer" ? "Cửa hàng xác nhận thủ công sau khi nhận tiền." : fulfillmentMethod === "delivery" ? "Thanh toán tiền mặt khi nhận hàng." : "Thanh toán tiền mặt khi nhận món."}</p>
              </form>
            )}

            {activePanel === "success" && (
              <div className="order-success">
                <span className="success-mark">✓</span>
                <p>Mã đơn hàng</p>
                <strong className="order-code">{orderCode}</strong>
                <p className={`order-email-status ${emailNotificationStatus === "sent" ? "is-sent" : emailNotificationStatus === "failed" ? "is-not-sent" : "is-sending"}`} role="status">
                  {emailNotificationStatus === "sent"
                    ? <>Đã gửi mã đơn tới <b>{orderEmail}</b>. Hãy kiểm tra cả mục thư rác nếu chưa thấy email.</>
                    : emailNotificationStatus === "sending"
                      ? <>Đang gửi mã đơn tới <b>{orderEmail}</b>…</>
                      : "Chưa gửi được email xác nhận. Mã đơn vẫn ở phía trên; hãy lưu lại để tra cứu đơn."}
                </p>
                {emailNotificationStatus === "failed" && (
                  <button
                    className="secondary-submit email-resend-button"
                    type="button"
                    onClick={() => void sendOrderConfirmationEmail(orderCode, orderPhone)}
                  >
                    Gửi lại email xác nhận
                  </button>
                )}
                <small>Đơn đã gửi đến {store.name}. Cửa hàng sẽ xác nhận và cập nhật trạng thái.</small>
                <div className="order-confirmed-total"><span>Tổng thanh toán</span><strong>{formatPrice(placedOrderTotal)}</strong></div>
                {orderDelivery?.method === "delivery" && (
                  <div className="order-delivery-summary">
                    <b>Giao tới</b>
                    <span>{orderDelivery.address}</span>
                    <small>{orderDelivery.distance == null ? "" : `${(orderDelivery.distance / 1000).toFixed(1)} km từ cửa hàng`} · Phí giao {formatPrice(orderDelivery.fee)}</small>
                  </div>
                )}
                {orderPayment?.method === "bank_transfer" && orderPayment.details && (
                  <>
                    <span className="payment-pending-badge">Đang chờ cửa hàng xác nhận thanh toán</span>
                    <BankTransferQr details={orderPayment.details} />
                  </>
                )}
                <a className="primary-button checkout-button" href="/track-order">Tra cứu đơn hàng <span>→</span></a>
                <button className="success-return" type="button" onClick={() => setActivePanel(null)}>Quay lại cửa hàng</button>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
