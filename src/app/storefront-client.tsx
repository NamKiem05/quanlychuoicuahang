"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import BankTransferQr, { type BankTransferDetails } from "@/app/bank-transfer-qr";
import type { StoreThemePreset, StorefrontLayoutPreset, StorefrontSection } from "@/lib/store-appearance";

export type StorefrontCategory = { id: string; name: string };

export type StorefrontProductOption = {
  id: string;
  name: string;
  price_adjustment_vnd: number;
};

export type StorefrontProductOptionGroup = {
  id: string;
  name: string;
  selection_mode: "single" | "multiple";
  min_selections: number;
  max_selections: number;
  options: StorefrontProductOption[];
};

export type StorefrontProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  label: string;
  image: string;
  stock_quantity: number | null;
  optionGroups: StorefrontProductOptionGroup[];
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
    theme_preset: StoreThemePreset;
    storefront_layout: StorefrontLayoutPreset;
    storefront_section_order: StorefrontSection[];
    storefront_hidden_sections: StorefrontSection[];
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

type CartLine = { id: string; productId: string; optionIds: string[]; quantity: number };
type ActivePanel = "cart" | "checkout" | "success" | "customize" | null;
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
type AppliedPromotion = { code: string; discountVnd: number; subtotalVnd: number };

export default function StorefrontClient({ store, categories, products, reviews }: StorefrontData) {
  const supabase = useMemo(() => createClient(), []);
  const contentOrder = (section: StorefrontSection) => 2 + store.storefront_section_order.indexOf(section);
  const isSectionVisible = (section: StorefrontSection) => !store.storefront_hidden_sections.includes(section);
  const [activeCategory, setActiveCategory] = useState("Tất cả");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [orderCode, setOrderCode] = useState("");
  const [orderEmail, setOrderEmail] = useState("");
  const [orderPhone, setOrderPhone] = useState("");
  const [emailNotificationStatus, setEmailNotificationStatus] = useState<"sending" | "sent" | "failed" | null>(null);
  const [placedOrderTotal, setPlacedOrderTotal] = useState(0);
  const [placedOrderDiscount, setPlacedOrderDiscount] = useState(0);
  const [placedPromotionCode, setPlacedPromotionCode] = useState("");
  const [promotionCodeInput, setPromotionCodeInput] = useState("");
  const [appliedPromotion, setAppliedPromotion] = useState<AppliedPromotion | null>(null);
  const [promotionFeedback, setPromotionFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const [isApplyingPromotion, setIsApplyingPromotion] = useState(false);
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
  const [customizingProductId, setCustomizingProductId] = useState<string | null>(null);
  const [customizingQuantity, setCustomizingQuantity] = useState(1);
  const [optionSelections, setOptionSelections] = useState<Record<string, string[]>>({});
  const [optionError, setOptionError] = useState("");
  const dialogRef = useRef<HTMLElement | null>(null);
  const dialogCloseRef = useRef<HTMLButtonElement | null>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!activePanel) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogCloseRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActivePanel(null);
        window.requestAnimationFrame(() => dialogTriggerRef.current?.focus());
        return;
      }
      if (event.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])");
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
  }, [activePanel]);
  const categoryNames = [
    "Tất cả",
    ...new Set([
      ...categories.map((category) => category.name),
      ...products.map((product) => product.category),
    ]),
  ];

  const cartLines = cart.flatMap((line) => {
    const product = products.find((item) => item.id === line.productId);
    if (!product) return [];
    const selectedOptions = product.optionGroups.flatMap((group) => group.options
      .filter((option) => line.optionIds.includes(option.id))
      .map((option) => ({ group: group.name, option })));
    return [{
      ...line,
      product,
      unitPrice: product.price + selectedOptions.reduce((sum, item) => sum + item.option.price_adjustment_vnd, 0),
      optionLabels: selectedOptions.map((item) => `${item.group}: ${item.option.name}`),
    }];
  });
  const customizingProduct = products.find((product) => product.id === customizingProductId) ?? null;
  const customizingProductQuantity = customizingProduct
    ? cart.filter((line) => line.productId === customizingProduct.id).reduce((sum, line) => sum + line.quantity, 0)
    : 0;
  const customizingUnitPrice = customizingProduct
    ? customizingProduct.price + customizingProduct.optionGroups.reduce((total, group) => total + group.options
        .filter((option) => (optionSelections[group.id] ?? []).includes(option.id))
        .reduce((sum, option) => sum + option.price_adjustment_vnd, 0), 0)
    : 0;
  const selectedOptionCount = Object.values(optionSelections).reduce((count, ids) => count + ids.length, 0);
  const cartCount = cart.reduce((count, line) => count + line.quantity, 0);
  const cartTotal = cartLines.reduce(
    (total, line) => total + line.unitPrice * line.quantity,
    0,
  );
  const promotionForCart = appliedPromotion?.subtotalVnd === cartTotal ? appliedPromotion : null;
  const promotionDiscount = promotionForCart?.discountVnd ?? 0;
  const checkoutTotal = cartTotal + (fulfillmentMethod === "delivery" ? Number(store.delivery_fee_vnd) : 0) - promotionDiscount;

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
    [activeCategory, products, search],
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

  function openProductPicker(product: StorefrontProduct, trigger?: HTMLElement) {
    if (trigger) dialogTriggerRef.current = trigger;
    const initialSelections: Record<string, string[]> = {};
    for (const group of product.optionGroups) {
      initialSelections[group.id] = [];
    }
    setCustomizingProductId(product.id);
    setCustomizingQuantity(1);
    setOptionSelections(initialSelections);
    setOptionError("");
    setActivePanel("customize");
  }

  function closeOrderModal() {
    setActivePanel(null);
    window.requestAnimationFrame(() => dialogTriggerRef.current?.focus());
  }

  function addConfiguredProduct(product: StorefrontProduct, selectedOptionIds: string[], quantity = 1) {
    if (product.stock_quantity === 0) return;
    const optionIds = [...selectedOptionIds].sort();
    const lineId = `${product.id}:${optionIds.join(",")}`;
    const currentProductQuantity = cart
      .filter((line) => line.productId === product.id)
      .reduce((sum, line) => sum + line.quantity, 0);
    if (quantity < 1 || quantity > 20 || (product.stock_quantity !== null && currentProductQuantity + quantity > product.stock_quantity)) {
      setOptionError("Giỏ hàng đã đạt số lượng tồn kho còn lại của món này.");
      return;
    }

    setCart((currentCart) => {
      const productQuantity = currentCart
        .filter((line) => line.productId === product.id)
        .reduce((sum, line) => sum + line.quantity, 0);
      if (productQuantity + quantity > 20 || (product.stock_quantity !== null && productQuantity + quantity > product.stock_quantity)) return currentCart;
      const existingLine = currentCart.find((line) => line.id === lineId);
      if (existingLine) {
        return currentCart.map((line) =>
          line.id === lineId
            ? { ...line, quantity: line.quantity + quantity }
            : line,
        );
      }
      return [...currentCart, { id: lineId, productId: product.id, optionIds, quantity }];
    });
    setAddedProduct(product.id);
    window.setTimeout(() => setAddedProduct(null), 1200);
    closeOrderModal();
  }

  function addToCart(productId: string, trigger?: HTMLElement) {
    const product = products.find((item) => item.id === productId);
    if (!product || product.stock_quantity === 0) return;
    openProductPicker(product, trigger);
  }

  function changeOptionSelection(group: StorefrontProductOptionGroup, optionId: string, isChecked: boolean) {
    setOptionSelections((current) => {
      const selected = current[group.id] ?? [];
      if (group.selection_mode === "single") return { ...current, [group.id]: [optionId] };
      if (isChecked) {
        if (selected.length >= group.max_selections) return current;
        return { ...current, [group.id]: [...selected, optionId] };
      }
      return { ...current, [group.id]: selected.filter((id) => id !== optionId) };
    });
    setOptionError("");
  }

  function submitProductOptions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const product = products.find((item) => item.id === customizingProductId);
    if (!product) return;
    for (const group of product.optionGroups) {
      const count = optionSelections[group.id]?.length ?? 0;
      if (count < group.min_selections || count > group.max_selections) {
        setOptionError(`Hãy chọn đúng số lựa chọn cho nhóm “${group.name}”.`);
        return;
      }
    }
    addConfiguredProduct(product, Object.values(optionSelections).flat(), customizingQuantity);
  }

  function changePickerQuantity(change: number) {
    if (!customizingProduct) return;
    const available = customizingProduct.stock_quantity === null
      ? 20
      : Math.max(0, Math.min(20, customizingProduct.stock_quantity - customizingProductQuantity));
    setCustomizingQuantity((quantity) => Math.max(1, Math.min(available, quantity + change)));
    setOptionError("");
  }

  function changeQuantity(lineId: string, change: number) {
    const currentLine = cart.find((line) => line.id === lineId);
    const product = products.find((item) => item.id === currentLine?.productId);
    if (change > 0 && currentLine && currentLine.quantity >= 20) return;
    if (change > 0 && product?.stock_quantity !== null && product?.stock_quantity !== undefined) {
      const currentProductQuantity = cart
        .filter((line) => line.productId === product.id)
        .reduce((sum, line) => sum + line.quantity, 0);
      if (currentProductQuantity >= product.stock_quantity) return;
    }
    const nextCart = cart
      .map((line) => line.id === lineId ? { ...line, quantity: line.quantity + change } : line)
      .filter((line) => line.quantity > 0);
    setCart(nextCart);
    if (nextCart.length === 0) setPaymentMethod("cash_on_pickup");
  }

  function changeFulfillmentMethod(method: "pickup" | "delivery") {
    setFulfillmentMethod(method);
    const nextTotal = cartTotal + (method === "delivery" ? Number(store.delivery_fee_vnd) : 0) - promotionDiscount;
    if (nextTotal <= 0) setPaymentMethod("cash_on_pickup");
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

  async function applyPromotion() {
    setOrderError("");
    const code = promotionCodeInput.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(code)) {
      setAppliedPromotion(null);
      setPromotionFeedback({ message: "Mã gồm 3–24 ký tự chữ, số hoặc dấu gạch ngang.", isError: true });
      return;
    }
    if (cartTotal <= 0) {
      setAppliedPromotion(null);
      setPromotionFeedback({ message: "Giỏ hàng chưa có giá trị để áp dụng mã.", isError: true });
      return;
    }

    setIsApplyingPromotion(true);
    setPromotionFeedback(null);
    try {
      const { data, error } = await supabase.rpc("preview_store_promotion", {
        requested_store_slug: store.slug,
        requested_promotion_code: code,
        requested_subtotal_vnd: cartTotal,
      });
      if (error || !data) {
        setAppliedPromotion(null);
        setPromotionFeedback({ message: "Mã không hợp lệ, chưa đến ngày dùng, đã hết hạn hoặc không đủ điều kiện đơn tối thiểu.", isError: true });
        return;
      }

      const result = data as { promotion_code: string; discount_vnd: number };
      const nextPromotion = {
        code: result.promotion_code,
        discountVnd: Number(result.discount_vnd),
        subtotalVnd: cartTotal,
      };
      setAppliedPromotion(nextPromotion);
      setPromotionCodeInput(result.promotion_code);
      setPromotionFeedback({ message: `Đã áp dụng mã ${result.promotion_code}.`, isError: false });
      if (cartTotal + (fulfillmentMethod === "delivery" ? Number(store.delivery_fee_vnd) : 0) - nextPromotion.discountVnd <= 0 && paymentMethod === "bank_transfer") {
        setPaymentMethod("cash_on_pickup");
      }
    } catch {
      setAppliedPromotion(null);
      setPromotionFeedback({ message: "Chưa kiểm tra được mã. Hãy thử lại.", isError: true });
    } finally {
      setIsApplyingPromotion(false);
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
    const requestedPromotionCode = promotionForCart?.code ?? "";
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
      const { data, error } = await supabase.rpc("create_guest_order_with_promotion", {
        requested_store_slug: store.slug,
        requested_customer_name: String(formData.get("customerName") ?? "").trim(),
        requested_customer_phone: customerPhone,
        requested_customer_note: String(formData.get("customerNote") ?? "").trim(),
        requested_items: cart.map((line) => ({
          product_id: line.productId,
          quantity: line.quantity,
          option_ids: line.optionIds,
        })),
        requested_payment_method: requestedPaymentMethod,
        requested_fulfillment: requestedFulfillment,
        requested_delivery_address: String(formData.get("deliveryAddress") ?? "").trim(),
        requested_delivery_latitude: deliveryLatitude ? Number(deliveryLatitude) : null,
        requested_delivery_longitude: deliveryLongitude ? Number(deliveryLongitude) : null,
        requested_customer_email: customerEmail,
        requested_promotion_code: requestedPromotionCode,
      });

      if (error || !data?.public_code) {
        const errorDetail = error?.message.toLowerCase() ?? "";
        setOrderError(errorDetail.includes("promotion")
          ? "Mã khuyến mãi vừa hết hạn, hết lượt hoặc không còn đủ điều kiện. Hãy kiểm tra lại mã rồi đặt đơn."
          : errorDetail.includes("out of stock")
            ? "Một món vừa hết hàng hoặc không còn đủ số lượng. Hãy cập nhật giỏ hàng rồi thử lại."
          : errorDetail.includes("product option")
            ? "Tùy chọn của một món vừa thay đổi. Hãy xóa món đó khỏi giỏ, chọn lại tùy chọn rồi đặt hàng."
          : errorDetail.includes("outside the store delivery radius")
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
      setPlacedOrderDiscount(Number(data.discount_vnd ?? 0));
      setPlacedPromotionCode(String(data.promotion_code ?? ""));
      setAppliedPromotion(null);
      setPromotionCodeInput("");
      setPromotionFeedback(null);
      setPaymentMethod("cash_on_pickup");
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
    <main className="storefront-page" id="top" data-theme={store.theme_preset} data-layout={store.storefront_layout}>
      <div className={"announcement" + (store.accepts_orders ? "" : " announcement-paused")} style={{ order: 0 }}>
        <span className="announcement-dot" aria-hidden="true" />
        {store.accepts_orders ? "Cửa hàng đang nhận đơn" : "Cửa hàng tạm ngưng nhận đơn"}
        <span className="announcement-right">Hiển thị trong bán kính 5 km</span>
      </div>

      <header className="site-header" style={{ order: 1 }}>
        <a className="brand" href="#top" aria-label={`${store.name} - trang chủ`}>
          {store.logo_url
            ? <Image className="brand-logo-image" src={store.logo_url} alt={`Logo ${store.name}`} width={44} height={44} unoptimized />
            : <span className="brand-mark">{store.name.trim().charAt(0).toUpperCase()}</span>}
          <span className="brand-name">{store.name}<span>.</span></span>
        </a>
        <nav className="main-nav" aria-label="Điều hướng chính">
          <a className="nav-active" href="#menu">Thực đơn</a>
          <Link href="/track-order">Tra cứu đơn</Link>
          {isSectionVisible("story") && <a href="#story">Về cửa hàng</a>}
          <a href="#footer">Liên hệ</a>
        </nav>
        <button className="cart-button" type="button" onClick={(event) => { dialogTriggerRef.current = event.currentTarget; setActivePanel("cart"); }} aria-label={`Giỏ hàng, ${cartCount} món`}>
          <span aria-hidden="true">▣</span>
          <span className="cart-label">Giỏ hàng</span>
          <span className="cart-count">{cartCount}</span>
        </button>
      </header>

      {isSectionVisible("hero") && <section className="hero" style={{ order: contentOrder("hero") }}>
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
      </section>}

      <section className="menu-section" id="menu" style={{ order: contentOrder("menu") }}>
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
              const productCartQuantity = cart.filter((line) => line.productId === product.id).reduce((sum, line) => sum + line.quantity, 0);
              const productAtStockLimit = product.stock_quantity !== null && productCartQuantity >= product.stock_quantity;
              const productReviews = reviewsByProduct.get(product.id) ?? [];
              const average = productReviews.length
                ? productReviews.reduce((sum, review) => sum + review.rating, 0) / productReviews.length
                : 0;

              return (
                <article className="product-card" key={product.id}>
                  <div className="product-image" style={{ backgroundImage: `url("${product.image}")` }}>
                    {product.label && <span className={`product-label${product.label === "Mới" ? " new-label" : ""}`}>{product.label === "Bán chạy" ? "★ " : "✳ "}{product.label}</span>}
                    {product.stock_quantity === 0 && <span className="product-label sold-out-label">Hết hàng</span>}
                    <button className="favorite-button" type="button" aria-label={`Yêu thích ${product.name}`}>♡</button>
                  </div>
                  <div className="product-info">
                    <div className="product-category">{product.category}</div>
                    <h3>{product.name}</h3>
                    <p>{product.description}</p>
                    {productReviews.length > 0 && <div className="product-rating"><span>★</span> {average.toFixed(1)} <small>({productReviews.length} đánh giá)</small></div>}
                    <div className="product-bottom">
                      <div><strong>{product.optionGroups.length > 0 ? `Từ ${formatPrice(product.price)}` : formatPrice(product.price)}</strong>{product.stock_quantity !== null && product.stock_quantity > 0 && <small className="product-stock">Còn {product.stock_quantity} món</small>}{product.optionGroups.length > 0 && <small className="product-stock">Có tùy chọn</small>}</div>
                      <button className={`add-button${addedProduct === product.id ? " added" : ""}`} onClick={(event) => addToCart(product.id, event.currentTarget)} type="button" disabled={!store.accepts_orders || product.stock_quantity === 0 || productAtStockLimit} aria-label={product.stock_quantity === 0 ? `${product.name} đã hết hàng` : productAtStockLimit ? `Đã đạt số lượng tồn kho của ${product.name}` : !store.accepts_orders ? "Cửa hàng tạm ngưng nhận đơn" : `Chọn món ${product.name}`}>
                        {!store.accepts_orders || product.stock_quantity === 0 ? "–" : addedProduct === product.id ? "✓" : "+"}
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

      {isSectionVisible("reviews") && <section className="reviews-section" id="reviews" style={{ order: contentOrder("reviews") }}>
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
      </section>}

      {isSectionVisible("story") && <section className="story-strip" id="story" style={{ order: contentOrder("story") }}>
        <span className="story-mark">M</span>
        <div><b>Món ngon địa phương, đặt trực tiếp từ cửa hàng.</b><p>{store.description || `Khám phá thực đơn của ${store.name}.`}</p></div>
        <a href="#menu">Chọn món yêu thích <span>↗</span></a>
      </section>}

      <footer id="footer" style={{ order: 7 }}>
        <a className="brand footer-brand" href="#top">{store.logo_url
          ? <Image className="brand-logo-image" src={store.logo_url} alt={`Logo ${store.name}`} width={38} height={38} unoptimized />
          : <span className="brand-mark">{store.name.trim().charAt(0).toUpperCase()}</span>}<span className="brand-name">{store.name}<span>.</span></span></a>
        <span>© 2026 {store.name}</span>
        <Link href="/track-order">Tra cứu đơn hàng</Link>
        <Link className="owner-footer-link" href="/login">Dành cho chủ quán ↗</Link>
        {store.phone && <span>Hotline <b>{store.phone}</b></span>}
      </footer>

      {cartCount > 0 && <button className="mobile-cart" type="button" style={{ order: 8 }} onClick={(event) => { dialogTriggerRef.current = event.currentTarget; setActivePanel("cart"); }}><span>▣ Giỏ hàng</span><b>{cartCount} món</b></button>}

      {activePanel && (
        <div className="dialog-backdrop" style={{ order: 9 }} onMouseDown={(event) => { if (event.target === event.currentTarget) closeOrderModal(); }}>
          <section
            ref={dialogRef}
            className={`order-dialog ${activePanel === "cart" ? "cart-dialog" : activePanel === "customize" ? "customize-dialog" : "checkout-dialog"}`}
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
                  {activePanel === "customize" && (customizingProduct?.optionGroups.length ? "Tùy chỉnh món" : "Thêm món vào giỏ")}
                </h2>
              </div>
              <button ref={dialogCloseRef} className="dialog-close" type="button" onClick={closeOrderModal} aria-label="Đóng">×</button>
            </div>

            {activePanel === "customize" && customizingProduct && (
              <form className="product-customize-form" onSubmit={submitProductOptions}>
                <div className="customize-product-summary">
                  <b>{customizingProduct.name}</b>
                  <span>Giá cơ bản {formatPrice(customizingProduct.price)}</span>
                  {customizingProduct.description && <small>{customizingProduct.description}</small>}
                </div>
                {!customizingProduct.optionGroups.length && <p className="product-picker-no-options">Món này không có tùy chọn thêm. Chọn số lượng rồi thêm vào giỏ.</p>}
                {customizingProduct.optionGroups.map((group) => {
                  const selected = optionSelections[group.id] ?? [];
                  const isSingle = group.selection_mode === "single";
                  return (
                    <fieldset className="payment-method-options customize-option-group" key={group.id}>
                      <legend>{group.name} {group.min_selections > 0 ? <span>· Bắt buộc</span> : <span>· Tùy chọn</span>}</legend>
                      {isSingle && group.min_selections === 0 && (
                        <label className={selected.length === 0 ? "payment-method-option selected" : "payment-method-option"}>
                          <input type="radio" name={`option-group-${group.id}`} checked={selected.length === 0} onChange={() => { setOptionSelections((current) => ({ ...current, [group.id]: [] })); setOptionError(""); }} />
                          <span><b>Không chọn</b><small>Giữ nguyên giá món</small></span>
                        </label>
                      )}
                      {group.options.map((option) => {
                        const checked = selected.includes(option.id);
                        const wouldIncreaseSelectionCount = !isSingle || selected.length === 0;
                        const disabledByLimit = !checked && ((!isSingle && selected.length >= group.max_selections) || (wouldIncreaseSelectionCount && selectedOptionCount >= 40));
                        return (
                          <label className={checked ? "payment-method-option selected" : "payment-method-option"} key={option.id}>
                            <input
                              type={isSingle ? "radio" : "checkbox"}
                              name={isSingle ? `option-group-${group.id}` : undefined}
                              checked={checked}
                              disabled={disabledByLimit}
                              onChange={(event) => changeOptionSelection(group, option.id, event.target.checked)}
                            />
                            <span><b>{option.name}</b><small>{option.price_adjustment_vnd > 0 ? `+${formatPrice(option.price_adjustment_vnd)}` : "Không cộng thêm"}</small></span>
                          </label>
                        );
                      })}
                    </fieldset>
                  );
                })}
                <div className="product-picker-quantity">
                  <span>Số lượng</span>
                  <div className="quantity-control">
                    <button type="button" onClick={() => changePickerQuantity(-1)} disabled={customizingQuantity <= 1} aria-label="Giảm số lượng">−</button>
                    <span>{customizingQuantity}</span>
                    <button type="button" onClick={() => changePickerQuantity(1)} disabled={customizingQuantity >= 20 || (customizingProduct.stock_quantity !== null && customizingProductQuantity + customizingQuantity >= customizingProduct.stock_quantity)} aria-label="Tăng số lượng">+</button>
                  </div>
                </div>
                {optionError && <p className="order-error" role="alert">{optionError}</p>}
                <button className="primary-button checkout-button" type="submit" disabled={!store.accepts_orders || customizingProduct.stock_quantity === 0 || (customizingProduct.stock_quantity !== null && customizingProductQuantity >= customizingProduct.stock_quantity)}>
                  {customizingProduct.stock_quantity !== null && customizingProductQuantity >= customizingProduct.stock_quantity ? "Đã đủ số lượng trong giỏ" : `Thêm ${customizingQuantity} món · ${formatPrice(customizingUnitPrice * customizingQuantity)}`}
                  <span>→</span>
                </button>
              </form>
            )}

            {activePanel === "cart" && (
              <>
                {cartLines.length > 0 ? (
                  <div className="cart-lines">
                    {cartLines.map(({ id, product, quantity, unitPrice, optionLabels }) => {
                      const productQuantity = cart.filter((line) => line.productId === product.id).reduce((sum, line) => sum + line.quantity, 0);
                      return (
                        <article className="cart-line" key={id}>
                          <div className="cart-thumb" style={{ backgroundImage: `url("${product.image}")` }} />
                          <div className="cart-line-info">
                            <b>{product.name}</b>
                            {optionLabels.map((label) => <small className="cart-option-label" key={label}>{label}</small>)}
                            <span>{formatPrice(unitPrice)} / món</span>
                            <div className="quantity-control">
                              <button type="button" onClick={() => changeQuantity(id, -1)} aria-label={`Giảm ${product.name}`}>−</button>
                              <span>{quantity}</span>
                              <button type="button" onClick={() => changeQuantity(id, 1)} disabled={quantity >= 20 || (product.stock_quantity !== null && productQuantity >= product.stock_quantity)} aria-label={`Tăng ${product.name}`}>+</button>
                            </div>
                          </div>
                          <strong className="line-total">{formatPrice(unitPrice * quantity)}</strong>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="cart-empty"><span>▣</span><b>Giỏ hàng đang trống</b><p>Chọn vài món ngon để {store.name} chuẩn bị nhé.</p><button type="button" onClick={() => { closeOrderModal(); document.querySelector("#menu")?.scrollIntoView({ behavior: "smooth" }); }}>Xem thực đơn</button></div>
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
                    <input type="radio" name="fulfillmentMethod" value="pickup" checked={fulfillmentMethod === "pickup"} onChange={() => changeFulfillmentMethod("pickup")} />
                    <span><b>Nhận tại cửa hàng</b><small>Không tính phí giao hàng.</small></span>
                  </label>
                  {store.delivery_enabled && (
                    <label className={fulfillmentMethod === "delivery" ? "payment-method-option selected" : "payment-method-option"}>
                      <input type="radio" name="fulfillmentMethod" value="delivery" checked={fulfillmentMethod === "delivery"} onChange={() => changeFulfillmentMethod("delivery")} />
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
                    <span><b>{checkoutTotal <= 0 ? "Không cần thanh toán" : fulfillmentMethod === "delivery" ? "Tiền mặt khi nhận hàng" : "Tiền mặt khi nhận món"}</b><small>{checkoutTotal <= 0 ? "Mã khuyến mãi đã giảm toàn bộ tiền món." : fulfillmentMethod === "delivery" ? "Thanh toán trực tiếp với người giao hàng." : "Thanh toán trực tiếp tại cửa hàng."}</small></span>
                  </label>
                  {store.bankTransfer && (
                    <label className={paymentMethod === "bank_transfer" ? "payment-method-option selected" : "payment-method-option"}>
                      <input type="radio" name="paymentMethod" value="bank_transfer" checked={paymentMethod === "bank_transfer"} disabled={checkoutTotal <= 0} onChange={() => setPaymentMethod("bank_transfer")} />
                      <span><b>Chuyển khoản QR</b><small>{checkoutTotal <= 0 ? "Đơn 0₫ không cần chuyển khoản." : "Quét mã QR theo số tiền và nội dung của đơn."}</small></span>
                    </label>
                  )}
                </fieldset>
                <section className="promotion-checkout" aria-label="Mã khuyến mãi">
                  <label htmlFor="promotion-code">Mã khuyến mãi</label>
                  <div className="promotion-checkout-input-row">
                    <input
                      id="promotion-code"
                      name="promotionCodeInput"
                      value={promotionCodeInput}
                      maxLength={24}
                      autoCapitalize="characters"
                      autoComplete="off"
                      placeholder="Nhập mã của cửa hàng"
                      onChange={(event) => {
                        setPromotionCodeInput(event.target.value.toUpperCase());
                        setAppliedPromotion(null);
                        setPromotionFeedback(null);
                      }}
                    />
                    {promotionForCart ? (
                      <button type="button" className="promotion-clear-button" onClick={() => { setAppliedPromotion(null); setPromotionCodeInput(""); setPromotionFeedback(null); }}>Bỏ mã</button>
                    ) : (
                      <button type="button" className="promotion-apply-button" onClick={() => void applyPromotion()} disabled={isApplyingPromotion || !store.accepts_orders}>
                        {isApplyingPromotion ? "Đang kiểm tra..." : "Áp dụng"}
                      </button>
                    )}
                  </div>
                  {appliedPromotion && !promotionForCart && <p className="promotion-feedback is-error" role="status">Giỏ hàng đã thay đổi. Hãy áp dụng lại mã.</p>}
                  {promotionFeedback && !(appliedPromotion && !promotionForCart) && <p className={`promotion-feedback${promotionFeedback.isError ? " is-error" : ""}`} role={promotionFeedback.isError ? "alert" : "status"}>{promotionFeedback.message}</p>}
                </section>
                {orderError && <p className="order-error" role="alert">{orderError}</p>}
                <div className="checkout-total"><span>Tạm tính · {cartCount} món</span><strong>{formatPrice(cartTotal)}</strong></div>
                {fulfillmentMethod === "delivery" && <div className="checkout-total delivery-fee-row"><span>Phí giao hàng</span><strong>{formatPrice(store.delivery_fee_vnd)}</strong></div>}
                {promotionForCart && <div className="checkout-total promotion-discount-row"><span>Giảm giá · {promotionForCart.code}</span><strong>−{formatPrice(promotionForCart.discountVnd)}</strong></div>}
                <div className="checkout-total grand-total"><span>Tổng thanh toán</span><strong>{formatPrice(checkoutTotal)}</strong></div>
                <button className="primary-button checkout-button" type="submit" disabled={!store.accepts_orders || isSubmittingOrder || isApplyingPromotion}>{isSubmittingOrder ? "Đang gửi đơn..." : isApplyingPromotion ? "Đang kiểm tra mã..." : "Đặt món và tạo đơn"}<span>→</span></button>
                <p className="payment-note">{checkoutTotal <= 0 ? "Mã khuyến mãi đã giảm toàn bộ tiền món; bạn không còn khoản cần thanh toán." : `${fulfillmentMethod === "delivery" ? "Cửa hàng tự giao đơn đến địa chỉ của bạn." : "Nhận món tại cửa hàng."} · ${paymentMethod === "bank_transfer" ? "Thanh toán sẽ được tự xác nhận nếu cửa hàng đã kết nối; nếu chưa, cửa hàng sẽ xác nhận thủ công." : fulfillmentMethod === "delivery" ? "Thanh toán tiền mặt khi nhận hàng." : "Thanh toán tiền mặt khi nhận món."}`}</p>
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
                {placedOrderDiscount > 0 && <div className="order-confirmed-discount"><span>Mã {placedPromotionCode}</span><strong>−{formatPrice(placedOrderDiscount)}</strong></div>}
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
                <Link className="primary-button checkout-button" href="/track-order">Tra cứu đơn hàng <span>→</span></Link>
                <button className="success-return" type="button" onClick={closeOrderModal}>Quay lại cửa hàng</button>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
