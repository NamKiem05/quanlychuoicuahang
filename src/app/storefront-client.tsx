"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import BankTransferQr, { type BankTransferDetails } from "@/app/bank-transfer-qr";
import SidebarIcon from "@/app/sidebar-icon";
import { getStoreBannerUrls, type StoreThemePreset, type StorefrontLayoutPreset, type StorefrontSection, type StorefrontStyle } from "@/lib/store-appearance";
import StoreBannerSlideshow from "@/app/store-banner-slideshow";
import RetailStorefront from "@/app/retail-storefront";
import RetailCart from "@/app/retail-cart";
import RetailCheckout from "@/app/retail-checkout";
import type { RetailVariant } from "@/app/retail-variant-picker";
import { getOrderHoursStatus, type OrderHours } from "@/lib/store-order-hours";
import "./storefront-closed-notice.css";
import "./storefront-styles.css";
import "./storefront-home.css";
import "./storefront-product-picker.css";

export type StorefrontCategory = { id: string; name: string; image: string | null };

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
  variants?: RetailVariant[];
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
  merchandiseMode?: "retail" | "general";
  store: {
    id: string;
    name: string;
    slug: string;
    description: string;
    phone: string | null;
    address: string | null;
    logo_url: string | null;
    banner_url: string | null;
    banner_urls?: string[];
    theme_preset: StoreThemePreset;
    storefront_style: StorefrontStyle;
    storefront_layout: StorefrontLayoutPreset;
    storefront_section_order: StorefrontSection[];
    storefront_hidden_sections: StorefrontSection[];
    accepts_orders: boolean;
    orderHours: OrderHours | null;
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
  initialTimestamp: number;
};

const formatPrice = (price: number) => `${price.toLocaleString("vi-VN")}₫`;
const formatDistance = (meters: number) => `${(meters / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} km`;

type CartLine = { id: string; productId: string; optionIds: string[]; variantId?: string; quantity: number };
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

function StoreClosedNotice({ paused, nextOpening, onDismiss }: {
  paused: boolean;
  nextOpening: string | null;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  return (
    <dialog ref={ref} className="storefront-closed-notice" aria-labelledby="storefront-closed-title" aria-describedby="storefront-closed-message" onClose={onDismiss}>
      <form method="dialog">
        <button className="storefront-closed-dismiss" type="submit" aria-label="Đóng thông báo">×</button>
        <div className="storefront-closed-icon" aria-hidden="true"><span /></div>
        <h2 id="storefront-closed-title">Cửa hàng đang đóng</h2>
        <p id="storefront-closed-message">{paused ? "Cửa hàng đang tạm ngưng nhận đơn." : "Cửa hàng đã ngoài giờ nhận đơn."} Bạn vẫn có thể xem sản phẩm.</p>
        {!paused && nextOpening && (
          <p className="storefront-closed-hours"><span>Mở lại lúc</span><strong>{nextOpening}</strong></p>
        )}
        <button className="storefront-closed-menu" type="submit">Xem sản phẩm <span aria-hidden="true">→</span></button>
      </form>
    </dialog>
  );
}

export default function StorefrontClient({ store, categories, products, reviews, initialTimestamp, merchandiseMode = "general" }: StorefrontData) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [timestamp, setTimestamp] = useState(initialTimestamp);
  useEffect(() => {
    if (!store.orderHours) return;
    const timer = window.setInterval(() => setTimestamp(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [store.orderHours]);
  const hoursStatus = getOrderHoursStatus(store.orderHours, Math.max(timestamp, initialTimestamp));
  const acceptsOrders = store.accepts_orders && hoursStatus.open;
  const closedMessage = !store.accepts_orders ? "Cửa hàng tạm ngưng nhận đơn"
    : hoursStatus.nextOpening ? `Quán mở lại lúc ${hoursStatus.nextOpening}` : "Quán đang ngoài giờ nhận đơn";
  const [closedNoticeDismissed, setClosedNoticeDismissed] = useState(false);
  const closedOnEntry = !store.accepts_orders || !getOrderHoursStatus(store.orderHours, initialTimestamp).open;
  const contentOrder = (section: StorefrontSection) => 2 + store.storefront_section_order.indexOf(section);
  const isSectionVisible = (section: StorefrontSection) => !store.storefront_hidden_sections.includes(section);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showFullMenu, setShowFullMenu] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const menuHeadingRef = useRef<HTMLHeadingElement>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [retailCartView, setRetailCartView] = useState(false);
  const [retailCheckoutView, setRetailCheckoutView] = useState(false);
  const [retailCheckoutError, setRetailCheckoutError] = useState("");
  const retailCheckoutPending = useRef(false);
  useEffect(() => {
    if (merchandiseMode !== "retail") return;
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout") === "1";
    const viewCart = params.get("cart") === "1";
    const frame = window.requestAnimationFrame(() => { try {
      const key = `growdesk-checkout:${store.id}`;
      const saved = (checkout ? localStorage.getItem(key) : null) || sessionStorage.getItem(`growdesk-cart:${store.id}`);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) setCart(parsed.filter((line): line is CartLine =>
          line && typeof line.id === "string" && typeof line.productId === "string" &&
          Array.isArray(line.optionIds) && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 20));
        localStorage.removeItem(key);
        sessionStorage.removeItem(`growdesk-cart:${store.id}`);
      }
      if (checkout || viewCart) setRetailCartView(true);
      if (params.get("search")) { setSearch(params.get("search") || ""); setShowFullMenu(true); }
      const url = new URL(window.location.href);
      url.searchParams.delete("checkout");
      url.searchParams.delete("cart");
      window.history.replaceState(window.history.state, "", url);
    } catch { /* A disabled or unavailable localStorage leaves the cart empty. */ } });
    return () => window.cancelAnimationFrame(frame);
  }, [merchandiseMode, store.id]);
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
  const [qrPaymentStatus, setQrPaymentStatus] = useState<"waiting" | "paid" | "closed">("waiting");

  useEffect(() => {
    if (activePanel !== "success" || orderPayment?.method !== "bank_transfer" ||
        !orderPayment.details || !orderCode || !orderPhone || qrPaymentStatus !== "waiting") return;
    let disposed = false;
    let checking = false;
    async function checkPayment() {
      if (disposed || checking || document.hidden) return;
      checking = true;
      try {
        const { data, error } = await supabase.rpc("track_guest_order", {
          requested_public_code: orderCode,
          requested_customer_phone: orderPhone,
        });
        if (disposed || error || !data) return;
        if (data.status === "cancelled" || data.status === "rejected") setQrPaymentStatus("closed");
        else if (data.payment_status === "paid") setQrPaymentStatus("paid");
      } catch {
        // A temporary lookup failure will be retried on the next interval.
      } finally {
        checking = false;
      }
    }
    void checkPayment();
    const timer = window.setInterval(() => void checkPayment(), 5000);
    document.addEventListener("visibilitychange", checkPayment);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkPayment);
    };
  }, [activePanel, orderCode, orderPhone, orderPayment, qrPaymentStatus, supabase]);
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
  const categoryNames = [...new Set([
    ...categories.map((category) => category.name),
    ...products.map((product) => product.category),
  ])];
  const categoryImages = new Map<string, string>();
  for (const category of categories) {
    if (category.image) categoryImages.set(category.name, category.image);
  }
  for (const product of products) {
    if (product.image && !categoryImages.has(product.category)) {
      categoryImages.set(product.category, product.image);
    }
  }

  const cartLines = cart.flatMap((line) => {
    const product = products.find((item) => item.id === line.productId);
    if (!product) return [];
    const variant = product.variants?.find((item) => item.id === line.variantId);
    const selectedOptions = product.optionGroups.flatMap((group) => group.options
      .filter((option) => line.optionIds.includes(option.id))
      .map((option) => ({ group: group.name, option })));
    return [{
      ...line,
      product,
      unitPrice: (variant?.price ?? product.price) + selectedOptions.reduce((sum, item) => sum + item.option.price_adjustment_vnd, 0),
      optionLabels: [...(variant ? Object.entries(variant.attributes).map(([name, value]) => `${name}: ${value}`) : []), ...selectedOptions.map((item) => `${item.group}: ${item.option.name}`)],
    }];
  });
  const customizingProduct = products.find((product) => product.id === customizingProductId) ?? null;
  const customizingProductQuantity = customizingProduct
    ? cart.filter((line) => line.productId === customizingProduct.id).reduce((sum, line) => sum + line.quantity, 0)
    : 0;
  const availablePickerQuantity = customizingProduct
    ? Math.max(0, Math.min(20, customizingProduct.stock_quantity ?? 20) - customizingProductQuantity)
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
          activeCategory === null || product.category === activeCategory;
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
  const featuredMenu = !showFullMenu && activeCategory === null && !search.trim() && products.length > 0;
  const displayedProducts = featuredMenu ? visibleProducts.slice(0, 4) : visibleProducts;

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

  function addConfiguredProduct(product: StorefrontProduct, selectedOptionIds: string[], quantity = 1, closeDialog = true, variantId?: string) {
    if (product.stock_quantity === 0) return;
    const optionIds = [...selectedOptionIds].sort();
    const lineId = `${product.id}:${variantId ?? ""}:${optionIds.join(",")}`;
    const variant = product.variants?.find((item) => item.id === variantId);
    if (product.variants?.length && !variant) return;
    const currentProductQuantity = cart
      .filter((line) => line.productId === product.id)
      .reduce((sum, line) => sum + line.quantity, 0);
    const variantQuantity = cart.filter((line) => line.productId === product.id && line.variantId === variantId).reduce((sum, line) => sum + line.quantity, 0);
    if (quantity < 1 || currentProductQuantity + quantity > 20 || (variant ? variantQuantity + quantity > variant.stock : currentProductQuantity + quantity > (product.stock_quantity ?? 20))) {
      setOptionError("Số lượng chọn vượt quá mức có thể thêm vào giỏ.");
      return;
    }

    setCart((currentCart) => {
      const productQuantity = currentCart
        .filter((line) => line.productId === product.id)
        .reduce((sum, line) => sum + line.quantity, 0);
      const currentVariantQuantity = currentCart.filter((line) => line.productId === product.id && line.variantId === variantId).reduce((sum, line) => sum + line.quantity, 0);
      if (productQuantity + quantity > 20 || (variant ? currentVariantQuantity + quantity > variant.stock : product.stock_quantity !== null && productQuantity + quantity > product.stock_quantity)) return currentCart;
      const existingLine = currentCart.find((line) => line.id === lineId);
      if (existingLine) {
        return currentCart.map((line) =>
          line.id === lineId
            ? { ...line, quantity: line.quantity + quantity }
            : line,
        );
      }
      return [...currentCart, { id: lineId, productId: product.id, optionIds, variantId, quantity }];
    });
    setAddedProduct(product.id);
    window.setTimeout(() => setAddedProduct(null), 1200);
    if (closeDialog) { closeOrderModal(); if (merchandiseMode === "retail") setRetailCartView(true); }
  }

  function addToCart(productId: string, trigger?: HTMLElement) {
    const product = products.find((item) => item.id === productId);
    if (!product || product.stock_quantity === 0) return;
    openProductPicker(product, trigger);
  }

  async function startRetailCheckout(trigger: HTMLButtonElement, pendingCart = cart) {
    if (retailCheckoutPending.current) return;
    retailCheckoutPending.current = true;
    setRetailCheckoutError("");
    dialogTriggerRef.current = trigger;
    let navigating = false;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error && (error.name === "AuthRetryableFetchError" || (error.status !== undefined && error.status >= 500))) {
        setRetailCheckoutError("Chưa kiểm tra được phiên đăng nhập. Hãy kiểm tra kết nối và thử lại.");
        setRetailCartView(true);
        return;
      }
      if (error || !data.user || !data.user.email_confirmed_at || data.user.is_anonymous) {
        try {
          localStorage.setItem(`growdesk-checkout:${store.id}`, JSON.stringify(pendingCart));
        } catch {
          setRetailCheckoutError("Trình duyệt chưa cho phép lưu giỏ hàng. Hãy bật lưu trữ trang web rồi thử lại.");
          setRetailCartView(true);
          return;
        }
        navigating = true;
        router.push(`/login?store=${encodeURIComponent(store.slug)}`);
        return;
      }
      setRetailCartView(false);
      setRetailCheckoutView(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      navigating = false;
      setRetailCheckoutError("Chưa kiểm tra được phiên đăng nhập. Hãy kiểm tra kết nối và thử lại.");
      setRetailCartView(true);
    } finally {
      if (!navigating) retailCheckoutPending.current = false;
    }
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
    setCustomizingQuantity((quantity) => Math.max(1, Math.min(availablePickerQuantity, quantity + change)));
    setOptionError("");
  }

  function changeQuantity(lineId: string, change: number) {
    const currentLine = cart.find((line) => line.id === lineId);
    const product = products.find((item) => item.id === currentLine?.productId);
    if (change > 0 && currentLine && currentLine.quantity >= 20) return;
    if (change > 0 && currentLine && cart.filter((line) => line.productId === currentLine.productId).reduce((sum, line) => sum + line.quantity, 0) >= 20) return;
    if (change > 0 && currentLine?.variantId) {
      const variant = product?.variants?.find((item) => item.id === currentLine.variantId);
      const total = cart.filter((line) => line.productId === currentLine.productId && line.variantId === currentLine.variantId).reduce((sum, line) => sum + line.quantity, 0);
      if (!variant || total >= variant.stock) return;
    }
    if (change > 0 && !currentLine?.variantId && product?.stock_quantity !== null && product?.stock_quantity !== undefined) {
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
    if (!acceptsOrders) {
      setOrderError(closedMessage);
      return;
    }
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
          ...(line.variantId ? { variant_id: line.variantId } : {}),
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
        setOrderError(errorDetail.includes("retail_customer_login_required")
          ? "Phiên đăng nhập đã hết hạn hoặc email chưa được xác minh. Hãy quay lại giỏ hàng và đăng nhập lại."
          : errorDetail.includes("outside order hours")
          ? "Quán vừa hết giờ nhận đơn. Bạn vẫn có thể xem thực đơn và đặt lại khi quán mở."
          : errorDetail.includes("promotion")
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
      setQrPaymentStatus("waiting");
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
      setRetailCheckoutView(false);
      setRetailCartView(false);
      setActivePanel("success");
      void sendOrderConfirmationEmail(data.public_code, customerPhone);
    } catch {
      setOrderError("Chưa gửi được đơn. Cửa hàng có thể vừa ngưng nhận đơn hoặc món đã thay đổi; hãy kiểm tra giỏ rồi thử lại.");
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  function openCart(trigger: HTMLButtonElement) {
    dialogTriggerRef.current = trigger;
    if (merchandiseMode === "retail") { setRetailCheckoutView(false); setRetailCartView(true); return; }
    setActivePanel("cart");
  }

  function resetMenu(fullMenu: boolean) {
    setActiveCategory(null);
    setSearch("");
    setShowFullMenu(fullMenu);
  }

  function submitMenuSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowFullMenu(true);
    menuHeadingRef.current?.focus({ preventScroll: true });
    menuHeadingRef.current?.scrollIntoView({ block: "start" });
  }

  const covers = getStoreBannerUrls(store.banner_urls, store.banner_url);
  const isRetail = merchandiseMode === "retail";
  return (
    <main className={`storefront-page storefront-home${isRetail ? " is-retail" : ""}`} id="top" data-theme={store.theme_preset} data-layout={store.storefront_layout} data-style={store.storefront_style}>
      {closedOnEntry && !acceptsOrders && !closedNoticeDismissed && (
        <StoreClosedNotice paused={!store.accepts_orders} nextOpening={hoursStatus.nextOpening} onDismiss={() => setClosedNoticeDismissed(true)} />
      )}
      {isRetail ? <RetailStorefront onAccountNavigate={() => { try { sessionStorage.setItem(`growdesk-cart:${store.id}`, JSON.stringify(cart)); document.cookie = `growdesk_customer_store=${encodeURIComponent(store.slug)}; path=/; max-age=2592000; samesite=lax${window.location.protocol === "https:" ? "; secure" : ""}`; } catch {} }} store={store} categories={categories} products={visibleProducts} allProducts={products} reviews={reviews} activeCategory={activeCategory} search={search} cartCount={cartCount} acceptsOrders={acceptsOrders} covers={covers} onCategory={(category) => { setActiveCategory(category); setSearch(""); setShowFullMenu(true); document.getElementById("retail-products")?.scrollIntoView({ behavior: "smooth" }); }} onSearch={setSearch} onSearchSubmit={() => { setShowFullMenu(true); document.getElementById("retail-products")?.scrollIntoView({ behavior: "smooth" }); }} onShowAll={() => resetMenu(true)} onCart={openCart} onAdd={addToCart} onConfirm={(id, optionIds, quantity, buyNow, trigger, variantId) => {
        if (buyNow && retailCheckoutPending.current) return "Đang kiểm tra phiên đăng nhập.";
        const product = products.find((item) => item.id === id);
        if (!product || !acceptsOrders) return "Cửa hàng chưa thể nhận đơn.";
        if (optionIds.length > 40 || product.optionGroups.some((group) => { const count = group.options.filter((option) => optionIds.includes(option.id)).length; return count < group.min_selections || count > group.max_selections; })) return "Hãy kiểm tra các lựa chọn sản phẩm.";
        const total = cart.filter((line) => line.productId === id).reduce((sum, line) => sum + line.quantity, 0);
        const variant = product.variants?.find((item) => item.id === variantId);
        const variantTotal = cart.filter((line) => line.productId === id && line.variantId === variantId).reduce((sum, line) => sum + line.quantity, 0);
        if (product.variants?.length && !variant) return "Hãy chọn biến thể sản phẩm.";
        if (quantity < 1 || total + quantity > 20 || (variant ? variantTotal + quantity > variant.stock : total + quantity > (product.stock_quantity ?? 20))) return "Số lượng vượt quá hàng còn lại hoặc giới hạn giỏ hàng.";
        addConfiguredProduct(product, optionIds, quantity, false, variantId);
        if (buyNow) {
          const sortedOptions = [...optionIds].sort();
          const lineId = `${product.id}:${variantId ?? ""}:${sortedOptions.join(",")}`;
          const existing = cart.find((line) => line.id === lineId);
          const pendingCart = existing
            ? cart.map((line) => line.id === lineId ? { ...line, quantity: line.quantity + quantity } : line)
            : [...cart, { id: lineId, productId: product.id, optionIds: sortedOptions, variantId, quantity }];
          void startRetailCheckout(trigger, pendingCart);
        } else setRetailCartView(true);
        return null;
      }} cartView={retailCartView} checkoutView={retailCheckoutView} onExitCart={() => { setRetailCartView(false); setRetailCheckoutView(false); }} renderCheckout={() => <RetailCheckout
        lines={cartLines} cartCount={cartCount} subtotal={cartTotal} discount={promotionDiscount} total={checkoutTotal}
        storeName={store.name} deliveryEnabled={store.delivery_enabled} deliveryFee={store.delivery_fee_vnd} deliveryRadius={store.delivery_radius_m} bankTransfer={Boolean(store.bankTransfer)}
        fulfillment={fulfillmentMethod} payment={paymentMethod} deliveryLocation={deliveryLocation} deliveryLocationMessage={deliveryLocationMessage} locating={isLocatingDelivery}
        promoInput={promotionCodeInput} promoCode={promotionForCart?.code ?? null} promoFeedback={promotionFeedback} promoStale={Boolean(appliedPromotion && !promotionForCart)}
        acceptsOrders={acceptsOrders} submitting={isSubmittingOrder} applying={isApplyingPromotion} error={orderError}
        onBack={() => { setOrderError(""); setRetailCheckoutView(false); setRetailCartView(true); }} onSubmit={placeOrder}
        onFulfillment={changeFulfillmentMethod} onPayment={setPaymentMethod} onAddressChange={() => { setDeliveryLocation(null); setDeliveryLocationMessage(""); }} onLocate={requestDeliveryLocation}
        onPromoInput={(value) => { setPromotionCodeInput(value); setAppliedPromotion(null); setPromotionFeedback(null); }}
        onPromoApply={() => { void applyPromotion(); }} onPromoClear={() => { setAppliedPromotion(null); setPromotionCodeInput(""); setPromotionFeedback(null); }}
      />} renderCart={(openDetail) => <RetailCart lines={cartLines} cartCount={cartCount} subtotal={cartTotal} discount={promotionDiscount} appliedCode={promotionForCart?.code ?? null} promotionInput={promotionCodeInput} promotionFeedback={promotionFeedback} promotionStale={Boolean(appliedPromotion && !promotionForCart)} applying={isApplyingPromotion} acceptsOrders={acceptsOrders} checkoutError={retailCheckoutError} recommendations={products.filter((product) => !cart.some((line) => line.productId === product.id))} onChange={changeQuantity} onPromotionInput={(value) => { setPromotionCodeInput(value); setAppliedPromotion(null); setPromotionFeedback(null); }} onApply={() => { void applyPromotion(); }} onClear={() => { setAppliedPromotion(null); setPromotionCodeInput(""); setPromotionFeedback(null); }} onContinue={() => { setRetailCartView(false); resetMenu(true); }} onCheckout={(trigger) => { void startRetailCheckout(trigger); }} onDetail={openDetail} />} cartQuantity={(id) => cart.filter((line) => line.productId === id).reduce((sum, line) => sum + line.quantity, 0)} /> : <>
      <header className="site-header">
        <h1 className="storefront-brand-heading">
          <a className="brand" href="#top" onClick={() => resetMenu(false)}>
            {store.logo_url
              ? <Image className="brand-logo-image" src={store.logo_url} alt="" width={44} height={44} unoptimized />
              : <span className="brand-mark" aria-hidden="true">{store.name.trim().charAt(0).toUpperCase()}</span>}
            <span className="brand-name">{store.name}</span>
          </a>
        </h1>
        <nav className="main-nav" aria-label="Điều hướng chính">
          <a className={showFullMenu ? undefined : "nav-active"} href="#top" onClick={() => resetMenu(false)}>Trang chủ</a>
          <a className={showFullMenu ? "nav-active" : undefined} href="#menu" onClick={() => resetMenu(true)}>Thực đơn</a>
          <a href="#promotions">Khuyến mãi</a>
          {isSectionVisible("reviews") && <a href="#reviews">Đánh giá</a>}
          <a href="#footer">Liên hệ</a>
        </nav>
        <form className="search-box" aria-label="Tìm trong thực đơn" role="search" onSubmit={submitMenuSearch}>
          <button type="submit" aria-label="Xem kết quả tìm món"><SidebarIcon name="search" /></button>
          <input type="search" placeholder="Tìm món ăn…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Tìm món ăn" />
        </form>
        <button className="cart-button" type="button" onClick={(event) => openCart(event.currentTarget)} aria-label={`Giỏ hàng, ${cartCount} món`}>
          <SidebarIcon name="cart" />
          {cartCount > 0 && <span className="cart-count" aria-hidden="true">{cartCount}</span>}
        </button>
      </header>
      {!acceptsOrders && <div className="announcement announcement-paused" style={{ order: 1 }}>
        <span className="announcement-dot" aria-hidden="true" />
        {closedMessage}
      </div>}

      {isSectionVisible("hero") && (
        <div className="storefront-banner" style={{ order: contentOrder("hero") }}>
          {covers.length ? (
            <StoreBannerSlideshow key={covers.join("|")} urls={covers} storeName={store.name} href="#menu" onOpenMenu={() => resetMenu(true)} />
          ) : (
            <div className="storefront-banner-fallback">
              <div><h2>{store.name}</h2>{store.description && <p>{store.description}</p>}</div>
              <a className="primary-button" href="#menu" onClick={() => resetMenu(true)}>Xem thực đơn <span aria-hidden="true">→</span></a>
            </div>
          )}
        </div>
      )}

      <section className="menu-section" id="menu" style={{ order: contentOrder("menu") }}>
        {categoryNames.length > 0 && (
          <div className="category-list" role="group" aria-label="Lọc theo danh mục">
            {[null, ...categoryNames].map((category) => {
              const image = category === null ? undefined : categoryImages.get(category);
              return (
                <button
                  className={`category-chip${activeCategory === category ? " selected" : ""}`}
                  key={category === null ? "all" : `category-${category}`}
                  onClick={() => { setActiveCategory(category); setShowFullMenu(true); }}
                  aria-pressed={activeCategory === category}
                  type="button"
                >
                  <span className="storefront-category-picture">
                    {image ? (
                      <Image src={image} alt="" fill sizes="96px" unoptimized />
                    ) : (
                      <SidebarIcon name={category === null ? "overview" : "menu"} />
                    )}
                  </span>
                  <span>{category ?? "Tất cả món"}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="section-heading">
          <h2 ref={menuHeadingRef} tabIndex={-1}>{featuredMenu ? "Món ăn nổi bật" : activeCategory ?? "Thực đơn"}</h2>
          {featuredMenu && visibleProducts.length > 4 && (
            <button className="storefront-section-link" type="button" onClick={() => { setShowFullMenu(true); menuHeadingRef.current?.focus(); }}>Xem tất cả <span aria-hidden="true">→</span></button>
          )}
        </div>

        {displayedProducts.length > 0 ? (
          <div className="product-grid">
            {displayedProducts.map((product) => {
              const productCartQuantity = cart.filter((line) => line.productId === product.id).reduce((sum, line) => sum + line.quantity, 0);
              const productAtStockLimit = product.stock_quantity !== null && productCartQuantity >= product.stock_quantity;
              const productReviews = reviewsByProduct.get(product.id) ?? [];
              const average = productReviews.length
                ? productReviews.reduce((sum, review) => sum + review.rating, 0) / productReviews.length
                : 0;

              return (
                <article className="product-card" key={product.id}>
                  <div className="product-image">
                    {product.image ? <Image src={product.image} alt="" fill sizes="(max-width: 640px) 50vw, (max-width: 960px) 33vw, 25vw" unoptimized /> : <SidebarIcon name="menu" />}
                    {product.label && <span className={`product-label${product.label === "Mới" ? " new-label" : ""}`}>{product.label === "Bán chạy" ? "★ " : "✳ "}{product.label}</span>}
                    {product.stock_quantity === 0 && <span className="product-label sold-out-label">Hết hàng</span>}
                  </div>
                  <div className="product-info">
                    <h3>{product.name}</h3>
                    {product.description && <p>{product.description}</p>}
                    <div className="product-bottom">
                      <div>
                        <strong>{product.optionGroups.length > 0 ? `Từ ${formatPrice(product.price)}` : formatPrice(product.price)}</strong>
                        {productReviews.length > 0 && <div className="product-rating"><span aria-hidden="true">★</span> {average.toFixed(1)} <small>({productReviews.length} đánh giá)</small></div>}
                        {product.stock_quantity !== null && product.stock_quantity > 0 && <small className="product-stock">Còn {product.stock_quantity} món</small>}
                      </div>
                      <button className={`add-button${addedProduct === product.id ? " added" : ""}`} onClick={(event) => addToCart(product.id, event.currentTarget)} type="button" disabled={!acceptsOrders || product.stock_quantity === 0 || productAtStockLimit} aria-label={product.stock_quantity === 0 ? `${product.name} đã hết hàng` : productAtStockLimit ? `Đã đạt số lượng tồn kho của ${product.name}` : !acceptsOrders ? "Cửa hàng tạm ngưng nhận đơn" : `Chọn món ${product.name}`}>
                        {!acceptsOrders || productAtStockLimit ? "–" : addedProduct === product.id ? "✓" : <SidebarIcon name="cart" />}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <b>{products.length ? "Chưa tìm thấy món phù hợp" : "Quán chưa có món đang bán"}</b>
            {products.length > 0 && <p>Thử tìm tên món khác hoặc chọn danh mục khác.</p>}
          </div>
        )}
      </section>

      <div className="storefront-extras" style={{ order: contentOrder("reviews") }}>
        <section className="storefront-promotions" id="promotions">
          <SidebarIcon name="promotions" />
          <div>
            <h2>Khuyến mãi</h2>
            <p>Bạn có mã ưu đãi? Nhập mã trong giỏ hàng trước khi đặt món.</p>
            {cartCount > 0 ? (
              <button className="storefront-promo-action" type="button" onClick={(event) => openCart(event.currentTarget)}>Mở giỏ hàng <span aria-hidden="true">→</span></button>
            ) : (
              <a className="storefront-promo-action" href="#menu" onClick={() => resetMenu(true)}>Chọn món <span aria-hidden="true">→</span></a>
            )}
          </div>
        </section>
        {isSectionVisible("reviews") && <section className="reviews-section" id="reviews">
          <div className="reviews-heading">
            <h2>Đánh giá khách hàng</h2>
            {reviews.length > 1 && <button className="storefront-section-link" type="button" aria-expanded={showAllReviews} aria-controls="storefront-review-list" onClick={() => setShowAllReviews((expanded) => !expanded)}>{showAllReviews ? "Thu gọn" : "Xem thêm"} <span aria-hidden="true">{showAllReviews ? "↑" : "→"}</span></button>}
          </div>
          {reviews.length > 0 ? (
            <div className="review-grid" id="storefront-review-list">
              {reviews.slice(0, showAllReviews ? 12 : 1).map((review) => {
                const image = products.find((product) => product.id === review.productId)?.image;
                return (
                  <article className="public-review-card" key={review.id}>
                    <div>
                      <div className="public-review-stars" aria-label={`${review.rating} trên 5 sao`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div>
                      <b>{review.productName}</b>
                      {review.body && <p>{review.body}</p>}
                      <footer><span>{review.displayName}</span><time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</time></footer>
                    </div>
                    {image && <Image className="storefront-review-image" src={image} width={88} height={88} alt="" unoptimized />}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="reviews-empty">Cửa hàng chưa có đánh giá được công khai.</div>
          )}
        </section>}
      </div>

      {isSectionVisible("story") && <section className="story-strip" id="story" style={{ order: contentOrder("story") }}>
        <span className="story-mark" aria-hidden="true">{store.name.trim().charAt(0).toUpperCase()}</span>
        <div><h2>Về {store.name}</h2>{store.description && <p>{store.description}</p>}{store.address && <p>{store.address}</p>}</div>
        <a href="#menu" onClick={() => resetMenu(true)}>Chọn món yêu thích <span aria-hidden="true">↗</span></a>
      </section>}

      <ul className="storefront-services" aria-label="Thông tin đặt hàng" style={{ order: 6 }}>
        <li><SidebarIcon name={store.delivery_enabled ? "delivery" : "store"} /><div><b>{store.delivery_enabled ? "Giao tận nơi" : "Nhận tại cửa hàng"}</b><span>{store.delivery_enabled ? `Trong bán kính ${formatDistance(store.delivery_radius_m)}` : "Đặt món trước khi đến"}</span></div></li>
        <li><SidebarIcon name="payment" /><div><b>Thanh toán</b><span>{store.bankTransfer ? "Tiền mặt hoặc chuyển khoản" : "Tiền mặt khi nhận món"}</span></div></li>
        <li><SidebarIcon name="orders" /><div><b><Link href="/track-order">Tra cứu đơn hàng</Link></b><span>Dùng mã đơn và số điện thoại</span></div></li>
        {store.phone && <li><SidebarIcon name="support" /><div><b>Liên hệ cửa hàng</b><a href={`tel:${store.phone}`}>{store.phone}</a></div></li>}
      </ul>

      <footer id="footer" style={{ order: 7 }}>
        <a className="brand footer-brand" href="#top">{store.logo_url
          ? <Image className="brand-logo-image" src={store.logo_url} alt={`Logo ${store.name}`} width={38} height={38} unoptimized />
          : <span className="brand-mark">{store.name.trim().charAt(0).toUpperCase()}</span>}<span className="brand-name">{store.name}<span>.</span></span></a>
        <span>© 2026 {store.name}</span>
        <Link href="/track-order">Tra cứu đơn hàng</Link>
        <Link className="owner-footer-link" href="/login">Dành cho chủ quán ↗</Link>
        {store.address && <span>{store.address}</span>}
        {store.phone && <a href={`tel:${store.phone}`}>{store.phone}</a>}
      </footer>

      {cartCount > 0 && <button className="mobile-cart" type="button" style={{ order: 8 }} onClick={(event) => openCart(event.currentTarget)}><span>Giỏ hàng</span><b>{cartCount} món</b></button>}

      </>}

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
                {activePanel !== "cart" && activePanel !== "customize" && <div className="eyebrow"><span>✳</span> {store.name.toLocaleUpperCase("vi-VN")}</div>}
                <h2 id="dialog-title">
                  {activePanel === "cart" && "Giỏ hàng của bạn"}
                  {activePanel === "checkout" && (isRetail ? "Thông tin đặt hàng" : "Thông tin đặt món")}
                  {activePanel === "success" && "Đơn hàng đã gửi"}
                  {activePanel === "customize" && (customizingProduct?.optionGroups.length ? (isRetail ? "Tùy chọn sản phẩm" : "Tùy chỉnh món") : (isRetail ? "Thêm sản phẩm vào giỏ" : "Thêm món vào giỏ"))}
                </h2>
                {activePanel === "cart" && <p className="storefront-cart-count">{cartCount} {isRetail ? "sản phẩm" : "món"} trong giỏ</p>}
              </div>
              <button ref={dialogCloseRef} className="dialog-close" type="button" onClick={closeOrderModal} aria-label="Đóng">×</button>
            </div>
            {activePanel === "customize" && customizingProduct && (
              <form className="product-customize-form" onSubmit={submitProductOptions}>
                <div className="customize-product-content">
                  <div className="customize-product-summary">
                    {customizingProduct.image && (
                      <div className="customize-product-photo">
                        <Image src={customizingProduct.image} alt="" fill sizes="128px" unoptimized />
                      </div>
                    )}
                    <div>
                      <h3>{customizingProduct.name}</h3>
                      {customizingProduct.description && <p>{customizingProduct.description}</p>}
                      <strong>{formatPrice(customizingProduct.price)}</strong>
                    </div>
                  </div>
                  {customizingProduct.optionGroups.map((group) => {
                    const selected = optionSelections[group.id] ?? [];
                    const isSingle = group.selection_mode === "single";
                    const selectionHint = group.min_selections === group.max_selections
                      ? `Chọn ${group.max_selections}`
                      : group.min_selections > 0
                        ? `Chọn ${group.min_selections}–${group.max_selections}`
                        : `Chọn tối đa ${group.max_selections}`;
                    return (
                      <fieldset className="payment-method-options customize-option-group" key={group.id}>
                        <legend>{group.name}<span data-required={group.min_selections > 0}>{selectionHint}</span></legend>
                        {isSingle && group.min_selections === 0 && (
                          <label className={selected.length === 0 ? "payment-method-option selected" : "payment-method-option"}>
                            <input type="radio" name={`option-group-${group.id}`} checked={selected.length === 0} onChange={() => { setOptionSelections((current) => ({ ...current, [group.id]: [] })); setOptionError(""); }} />
                            <span>Không chọn</span>
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
                              <span>{option.name}</span>
                              {option.price_adjustment_vnd > 0 && <strong>+{formatPrice(option.price_adjustment_vnd)}</strong>}
                            </label>
                          );
                        })}
                      </fieldset>
                    );
                  })}
                </div>
                <div className="product-picker-footer">
                  <div className="product-picker-quantity">
                    <span>Số lượng</span>
                    <div className="quantity-control" role="group" aria-label={isRetail ? "Số lượng sản phẩm" : "Số lượng món"}>
                      <button type="button" onClick={() => changePickerQuantity(-1)} disabled={customizingQuantity <= 1} aria-label="Giảm số lượng">−</button>
                      <output>{customizingQuantity}</output>
                      <button type="button" onClick={() => changePickerQuantity(1)} disabled={customizingQuantity >= availablePickerQuantity} aria-label="Tăng số lượng">+</button>
                    </div>
                  </div>
                  <button className="primary-button product-picker-submit" type="submit" disabled={!acceptsOrders || customizingQuantity > availablePickerQuantity}>
                    {availablePickerQuantity === 0 ? "Đã đạt số lượng tối đa" : (
                      <>
                        <span><SidebarIcon name="cart" />Thêm vào giỏ</span>
                        <strong>{formatPrice(customizingUnitPrice * customizingQuantity)}</strong>
                      </>
                    )}
                  </button>
                  {optionError && <p className="order-error" role="alert">{optionError}</p>}
                </div>
              </form>
            )}

            {activePanel === "cart" && (
              <>
                {cartLines.length > 0 ? (
                  <div className="storefront-cart-layout">
                    <div className="cart-lines" aria-label={isRetail ? "Sản phẩm trong giỏ" : "Món trong giỏ"}>
                      {cartLines.map(({ id, product, quantity, unitPrice, optionLabels }) => {
                        const productQuantity = cart.filter((line) => line.productId === product.id).reduce((sum, line) => sum + line.quantity, 0);
                        return (
                          <article className="cart-line" key={id}>
                            <div className="cart-thumb" style={{ backgroundImage: `url("${product.image}")` }} />
                            <div className="cart-line-info">
                              <b>{product.name}</b>
                              {optionLabels.map((label) => <small className="cart-option-label" key={label}>{label}</small>)}
                              <div className="quantity-control">
                                <button type="button" onClick={() => changeQuantity(id, -1)} aria-label={`Giảm ${product.name}`}>−</button>
                                <span>{quantity}</span>
                                <button type="button" onClick={() => changeQuantity(id, 1)} disabled={quantity >= 20 || (product.stock_quantity !== null && productQuantity >= product.stock_quantity)} aria-label={`Tăng ${product.name}`}>+</button>
                              </div>
                            </div>
                            <div className="storefront-cart-line-price">
                              <strong className="line-total">{formatPrice(unitPrice * quantity)}</strong>
                              <small>{formatPrice(unitPrice)} / {isRetail ? "sản phẩm" : "món"}</small>
                              <button type="button" onClick={() => changeQuantity(id, -quantity)} aria-label={`Xóa ${product.name} khỏi giỏ`}>Xóa</button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                    <aside className="cart-summary storefront-cart-price" aria-label="Tổng tiền giỏ hàng">
                      <h3>Tóm tắt đơn hàng</h3>
                      <div><span>Tạm tính</span><strong>{formatPrice(cartTotal)}</strong></div>
                      <div className="promotion-discount-row"><span>Giảm giá{promotionForCart ? ` · ${promotionForCart.code}` : ""}</span><strong>{promotionDiscount > 0 ? "−" : ""}{formatPrice(promotionDiscount)}</strong></div>
                      {store.delivery_enabled && <div><span>Phí giao hàng</span><small>Tính ở bước thanh toán</small></div>}
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
                            <button type="button" className="promotion-apply-button" onClick={() => void applyPromotion()} disabled={isApplyingPromotion || !acceptsOrders}>
                              {isApplyingPromotion ? "Đang kiểm tra..." : "Áp dụng"}
                            </button>
                          )}
                        </div>
                        {appliedPromotion && !promotionForCart && <p className="promotion-feedback is-error" role="status">Giỏ hàng đã thay đổi. Hãy áp dụng lại mã.</p>}
                        {promotionFeedback && !(appliedPromotion && !promotionForCart) && <p className={`promotion-feedback${promotionFeedback.isError ? " is-error" : ""}`} role={promotionFeedback.isError ? "alert" : "status"}>{promotionFeedback.message}</p>}
                      </section>
                      <div className="storefront-cart-discounted"><span>Tổng cộng</span><strong>{formatPrice(cartTotal - promotionDiscount)}</strong></div>
                      <button className="primary-button checkout-button" type="button" disabled={!acceptsOrders || isApplyingPromotion} onClick={() => setActivePanel("checkout")}>Thanh toán</button>
                    </aside>
                  </div>
                ) : (
                  <div className="cart-empty"><span>▣</span><b>Giỏ hàng đang trống</b><p>{isRetail ? "Chọn sản phẩm bạn yêu thích nhé." : `Chọn vài món ngon để ${store.name} chuẩn bị nhé.`}</p><button type="button" onClick={() => { closeOrderModal(); document.querySelector(isRetail ? "#retail-products" : "#menu")?.scrollIntoView({ behavior: "smooth" }); }}>{isRetail ? "Xem sản phẩm" : "Xem thực đơn"}</button></div>
                )}
              </>
            )}

            {activePanel === "checkout" && (
              <form className="checkout-form" onSubmit={placeOrder}>
                <button className="storefront-return-to-cart" type="button" onClick={() => { setOrderError(""); if (isRetail) { setActivePanel(null); setRetailCartView(true); } else setActivePanel("cart"); }}>← Về giỏ hàng</button>
                <div className="pickup-note"><span>{fulfillmentMethod === "delivery" ? "⌖" : "⌂"}</span><div><b>{fulfillmentMethod === "delivery" ? "Giao tận nơi" : "Nhận tại cửa hàng"}</b><small>{fulfillmentMethod === "delivery" ? `Cửa hàng giao trong bán kính ${formatDistance(store.delivery_radius_m)}.` : `${store.name} sẽ xác nhận đơn và thời gian ${isRetail ? "nhận hàng" : "nhận món"}.`}</small></div></div>
                <label>Họ và tên<input name="customerName" autoComplete="name" placeholder="Tên người nhận" required /></label>
                <label>Số điện thoại<input name="customerPhone" type="tel" autoComplete="tel" inputMode="tel" pattern="[0-9+() .-]{9,16}" placeholder="Ví dụ: 090 123 4567" required /></label>
                <label>Email nhận mã đơn<input name="customerEmail" type="email" autoComplete="email" maxLength={254} placeholder="ban@example.com" required /></label>
                <fieldset className="payment-method-options fulfillment-options">
                  <legend>{isRetail ? "Cách nhận hàng" : "Cách nhận món"}</legend>
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
                <label>{isRetail ? "Ghi chú cho cửa hàng" : "Ghi chú cho quán"} <span className="optional-label">Không bắt buộc</span><textarea name="customerNote" rows={3} maxLength={500} placeholder={isRetail ? "Ghi chú cho đơn hàng..." : "Ít cay, để riêng nước sốt..."} /></label>
                <fieldset className="payment-method-options">
                  <legend>Phương thức thanh toán</legend>
                  <label className={paymentMethod === "cash_on_pickup" ? "payment-method-option selected" : "payment-method-option"}>
                    <input type="radio" name="paymentMethod" value="cash_on_pickup" checked={paymentMethod === "cash_on_pickup"} onChange={() => setPaymentMethod("cash_on_pickup")} />
                    <span><b>{checkoutTotal <= 0 ? "Không cần thanh toán" : fulfillmentMethod === "delivery" ? "Tiền mặt khi nhận hàng" : (isRetail ? "Tiền mặt khi nhận hàng" : "Tiền mặt khi nhận món")}</b><small>{checkoutTotal <= 0 ? (isRetail ? "Mã khuyến mãi đã giảm toàn bộ tiền sản phẩm." : "Mã khuyến mãi đã giảm toàn bộ tiền món.") : fulfillmentMethod === "delivery" ? "Thanh toán trực tiếp với người giao hàng." : "Thanh toán trực tiếp tại cửa hàng."}</small></span>
                  </label>
                  {store.bankTransfer && (
                    <label className={paymentMethod === "bank_transfer" ? "payment-method-option selected" : "payment-method-option"}>
                      <input type="radio" name="paymentMethod" value="bank_transfer" checked={paymentMethod === "bank_transfer"} disabled={checkoutTotal <= 0} onChange={() => setPaymentMethod("bank_transfer")} />
                      <span><b>Chuyển khoản QR</b><small>{checkoutTotal <= 0 ? "Đơn 0₫ không cần chuyển khoản." : "Quét mã QR theo số tiền và nội dung của đơn."}</small></span>
                    </label>
                  )}
                </fieldset>
                {orderError && <p className="order-error" role="alert">{orderError}</p>}
                <div className="checkout-total"><span>Tạm tính · {cartCount} {isRetail ? "sản phẩm" : "món"}</span><strong>{formatPrice(cartTotal)}</strong></div>
                {fulfillmentMethod === "delivery" && <div className="checkout-total delivery-fee-row"><span>Phí giao hàng</span><strong>{formatPrice(store.delivery_fee_vnd)}</strong></div>}
                {promotionForCart && <div className="checkout-total promotion-discount-row"><span>Giảm giá · {promotionForCart.code}</span><strong>−{formatPrice(promotionForCart.discountVnd)}</strong></div>}
                <div className="checkout-total grand-total"><span>Tổng thanh toán</span><strong>{formatPrice(checkoutTotal)}</strong></div>
                <button className="primary-button checkout-button" type="submit" disabled={!acceptsOrders || isSubmittingOrder || isApplyingPromotion}>{isSubmittingOrder ? "Đang gửi đơn..." : isApplyingPromotion ? "Đang kiểm tra mã..." : (isRetail ? "Đặt hàng" : "Đặt món và tạo đơn")}<span>→</span></button>
                <p className="payment-note">{checkoutTotal <= 0 ? (isRetail ? "Mã khuyến mãi đã giảm toàn bộ tiền sản phẩm; bạn không còn khoản cần thanh toán." : "Mã khuyến mãi đã giảm toàn bộ tiền món; bạn không còn khoản cần thanh toán.") : `${fulfillmentMethod === "delivery" ? "Cửa hàng tự giao đơn đến địa chỉ của bạn." : (isRetail ? "Nhận hàng tại cửa hàng." : "Nhận món tại cửa hàng.")} · ${paymentMethod === "bank_transfer" ? "Thanh toán sẽ được tự xác nhận nếu cửa hàng đã kết nối; nếu chưa, cửa hàng sẽ xác nhận thủ công." : fulfillmentMethod === "delivery" ? "Thanh toán tiền mặt khi nhận hàng." : (isRetail ? "Thanh toán tiền mặt khi nhận hàng." : "Thanh toán tiền mặt khi nhận món.")}`}</p>
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
                      : isRetail ? "Chưa gửi được email xác nhận. Bạn vẫn có thể xem đơn trong tài khoản mua hàng." : "Chưa gửi được email xác nhận. Mã đơn vẫn ở phía trên; hãy lưu lại để tra cứu đơn."}
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
                    <span className={qrPaymentStatus === "paid" ? "payment-paid-badge" : "payment-pending-badge"} role="status">
                      {qrPaymentStatus === "paid" ? "Đã xác nhận thanh toán" : qrPaymentStatus === "closed" ? "Đơn đã đóng. Nếu đã chuyển tiền, hãy liên hệ cửa hàng." : "Đang chờ chuyển khoản"}
                    </span>
                    {qrPaymentStatus === "waiting" && <BankTransferQr details={orderPayment.details} />}
                  </>
                )}
                <Link className="primary-button checkout-button" href={isRetail ? "/customer/orders" : "/track-order"}>{isRetail ? "Xem đơn hàng của tôi" : "Tra cứu đơn hàng"} <span>→</span></Link>
                <button className="success-return" type="button" onClick={closeOrderModal}>Quay lại cửa hàng</button>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
