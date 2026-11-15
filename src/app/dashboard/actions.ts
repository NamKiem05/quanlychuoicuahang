"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "node:crypto";
import { resolveCname, resolveTxt } from "node:dns/promises";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { getBankByCode } from "@viet-qr/core";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseEnv } from "@/lib/supabase/env";
import {
  isStoreThemePreset,
  isStorefrontLayoutPreset,
  isStorefrontSection,
  storefrontSectionIds,
} from "@/lib/store-appearance";
import { sendOrderStatusNotice, type OrderStatusNotice } from "@/lib/email/order-status";

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function isValidDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function vietnamToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function orderListRedirect(formData: FormData, message: string) {
  const params = new URLSearchParams({ message });
  const query = formText(formData, "filter_query").replace(/[^\p{L}\p{N}\s+-]/gu, "").slice(0, 60).trim();
  const status = formText(formData, "filter_status");
  const validStatuses = ["pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled", "rejected"];
  if (query) params.set("q", query);
  if (validStatuses.includes(status)) params.set("filter_status", status);
  const page = formText(formData, "filter_page");
  if (/^[1-9]\d{0,6}$/.test(page) && page !== "1") params.set("page", page);
  return "/dashboard/orders?" + params.toString();
}

function slugify(value: string) {
  return value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getOwnedProductImagePath(url: string | null, storeId: string) {
  if (!url) return null;
  const storagePrefix = getSupabaseEnv().url.replace(/\/$/, "") + "/storage/v1/object/public/product-images/";
  if (!url.startsWith(storagePrefix)) return null;

  try {
    const path = decodeURIComponent(url.slice(storagePrefix.length));
    const parts = path.split("/");
    if (parts.length !== 2 || parts[0] !== storeId || !parts[1] || parts[1] === "." || parts[1] === "..") return null;
    return path;
  } catch {
    return null;
  }
}

async function removeOwnedProductImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  url: string | null,
  storeId: string,
) {
  const path = getOwnedProductImagePath(url, storeId);
  if (!path) return false;
  const { error } = await supabase.storage.from("product-images").remove([path]);
  return Boolean(error);
}

function getOwnedStoreAppearanceAssetPath(url: string | null, storeId: string, kind: "logo" | "banner") {
  const path = getOwnedProductImagePath(url, storeId);
  if (!path) return null;
  const filename = path.split("/")[1];
  return filename.startsWith(`branding-${kind}-`) && /\.(jpg|png|webp)$/i.test(filename) ? path : null;
}

async function getSessionUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (!userId) redirect("/login");
  return { supabase, userId };
}

async function getManagedStoreId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: membership } = await supabase
    .from("store_members")
    .select("store_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/dashboard");
  return membership.store_id;
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createStore(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const name = formText(formData, "name");
  const phone = formText(formData, "phone");
  const address = formText(formData, "address");
  const slug = slugify(formText(formData, "slug") || name);
  const latitudeText = formText(formData, "latitude");
  const longitudeText = formText(formData, "longitude");

  if (!name || !slug || name.length > 120) redirect("/dashboard?message=invalid-store");
  if (Boolean(latitudeText) !== Boolean(longitudeText)) redirect("/dashboard?message=invalid-location");

  let location: string | null = null;
  if (latitudeText && longitudeText) {
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    ) {
      redirect("/dashboard?message=invalid-location");
    }
    location = `SRID=4326;POINT(${longitude} ${latitude})`;
  }

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .insert({
      created_by: userId,
      name,
      slug,
      phone: phone || null,
      address: address || null,
      location,
      status: "draft",
    })
    .select("id")
    .single();

  if (storeError || !store) redirect("/dashboard?message=store-create-failed");

  const { error: membershipError } = await supabase.from("store_members").insert({
    store_id: store.id,
    user_id: userId,
    role: "owner",
  });

  if (membershipError) redirect("/dashboard?message=membership-create-failed");
  redirect("/dashboard?message=store-created");
}

export async function updateStoreLocation(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const { data: membership } = await supabase
    .from("store_members")
    .select("store_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/dashboard/store?message=owner-required");

  const latitudeText = formText(formData, "latitude");
  const longitudeText = formText(formData, "longitude");
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  if (
    !latitudeText || !longitudeText ||
    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
  ) {
    redirect("/dashboard/store?message=invalid-location");
  }

  const { error } = await supabase
    .from("stores")
    .update({ location: `SRID=4326;POINT(${longitude} ${latitude})` })
    .eq("id", membership.store_id);
  redirect(error ? "/dashboard/store?message=location-update-failed" : "/dashboard/store?message=location-updated");
}

export async function updateStoreProfile(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const { data: membership } = await supabase
    .from("store_members")
    .select("store_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/dashboard/store?message=owner-required");

  const name = formText(formData, "name");
  const slug = slugify(formText(formData, "slug"));
  const phone = formText(formData, "phone");
  const address = formText(formData, "address");
  if (
    name.length < 2 || name.length > 120 ||
    !slug || slug.length > 80 || phone.length > 30 || address.length > 255
  ) {
    redirect("/dashboard/store?message=invalid-store-profile");
  }

  const { data: matchingStore } = await supabase
    .from("stores")
    .select("id")
    .eq("slug", slug)
    .neq("id", membership.store_id)
    .maybeSingle();
  if (matchingStore) redirect("/dashboard/store?message=store-slug-taken");

  const { error } = await supabase
    .from("stores")
    .update({
      name,
      slug,
      phone: phone || null,
      address: address || null,
    })
    .eq("id", membership.store_id);

  if (error?.code === "23505") redirect("/dashboard/store?message=store-slug-taken");
  redirect(error ? "/dashboard/store?message=store-profile-update-failed" : "/dashboard/store?message=store-profile-updated");
}

export async function saveStoreAppearance(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const { data: membership } = await supabase
    .from("store_members")
    .select("store_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/dashboard/store?message=owner-required");

  const rawLogoUrl = formText(formData, "logo_url");
  const rawBannerUrl = formText(formData, "banner_url");
  const theme = formText(formData, "theme_preset");
  const layout = formText(formData, "storefront_layout");
  const sectionOrder = formData.getAll("storefront_section_order").map((value) => String(value));
  const hiddenSections = [...new Set(formData.getAll("storefront_hidden_sections").map((value) => String(value)))];
  const { data: store } = await supabase
    .from("stores")
    .select("id, slug, logo_url, banner_url")
    .eq("id", membership.store_id)
    .maybeSingle();
  if (!store) redirect("/dashboard/appearance?message=store-appearance-save-failed");

  const logoUrl = rawLogoUrl || null;
  const bannerUrl = rawBannerUrl || null;
  const validOrder = sectionOrder.length === storefrontSectionIds.length
    && new Set(sectionOrder).size === storefrontSectionIds.length
    && sectionOrder.every(isStorefrontSection)
    && storefrontSectionIds.every((section) => sectionOrder.includes(section));
  const validHiddenSections = hiddenSections.every((section) => isStorefrontSection(section) && section !== "menu");
  const validLogo = rawLogoUrl.length <= 2048 && (!rawLogoUrl || rawLogoUrl === store.logo_url || Boolean(getOwnedStoreAppearanceAssetPath(rawLogoUrl, store.id, "logo")));
  const validBanner = rawBannerUrl.length <= 2048 && (!rawBannerUrl || rawBannerUrl === store.banner_url || Boolean(getOwnedStoreAppearanceAssetPath(rawBannerUrl, store.id, "banner")));
  if (
    !validLogo || !validBanner || !isStoreThemePreset(theme) || !isStorefrontLayoutPreset(layout) ||
    !validOrder || !validHiddenSections
  ) {
    redirect("/dashboard/appearance?message=invalid-store-appearance");
  }

  const { error } = await supabase
    .from("stores")
    .update({
      logo_url: logoUrl,
      banner_url: bannerUrl,
      theme_preset: theme,
      storefront_layout: layout,
      storefront_section_order: sectionOrder,
      storefront_hidden_sections: hiddenSections,
    })
    .eq("id", store.id);
  if (error) redirect("/dashboard/appearance?message=store-appearance-save-failed");

  revalidatePath(`/${store.slug}`);
  revalidatePath("/dashboard/appearance");

  let cleanupFailed = false;
  for (const [kind, previousUrl, nextUrl] of [
    ["logo", store.logo_url, logoUrl],
    ["banner", store.banner_url, bannerUrl],
  ] as const) {
    if (!previousUrl || previousUrl === nextUrl) continue;
    const path = getOwnedStoreAppearanceAssetPath(previousUrl, store.id, kind);
    if (!path) continue;
    const { error: cleanupError } = await supabase.storage.from("product-images").remove([path]);
    cleanupFailed ||= Boolean(cleanupError);
  }

  redirect(cleanupFailed
    ? "/dashboard/appearance?message=store-appearance-image-cleanup-failed"
    : "/dashboard/appearance?message=store-appearance-saved");
}

export async function updateStoreOrderAcceptance(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const { data: membership } = await supabase
    .from("store_members")
    .select("store_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/dashboard/store?message=owner-required");

  const requestedValue = formText(formData, "accepts_orders");
  if (!["true", "false"].includes(requestedValue)) {
    redirect("/dashboard/store?message=invalid-store-order-setting");
  }

  const acceptsOrders = requestedValue === "true";
  const { error } = await supabase
    .from("stores")
    .update({ accepts_orders: acceptsOrders })
    .eq("id", membership.store_id);

  if (error) redirect("/dashboard/store?message=store-order-setting-failed");
  redirect(acceptsOrders ? "/dashboard/store?message=store-orders-enabled" : "/dashboard/store?message=store-orders-paused");
}

export async function updateStorePaymentSettings(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const { data: membership } = await supabase
    .from("store_members")
    .select("store_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/dashboard/store?message=owner-required");

  const bankCode = formText(formData, "bank_code").toUpperCase();
  const accountNumber = formText(formData, "account_number");
  const accountName = formText(formData, "account_name");
  const enabledText = formText(formData, "is_enabled");
  const bank = getBankByCode(bankCode);

  if (!bank || !/^[0-9]{6,30}$/.test(accountNumber) || accountName.length < 2 || accountName.length > 100 || !["true", "false"].includes(enabledText)) {
    redirect("/dashboard/store?message=invalid-payment-settings");
  }

  const { data: previousSettings } = await supabase
    .from("store_payment_methods")
    .select("bank_code, account_number")
    .eq("store_id", membership.store_id)
    .maybeSingle();
  const accountChanged = Boolean(previousSettings && (
    previousSettings.bank_code !== bank.code || previousSettings.account_number !== accountNumber
  ));

  const { error } = await supabase.from("store_payment_methods").upsert({
    store_id: membership.store_id,
    bank_code: bank.code,
    bank_name: bank.fullName,
    account_number: accountNumber,
    account_name: accountName,
    is_enabled: enabledText === "true",
  }, { onConflict: "store_id" });

  if (!error && (accountChanged || enabledText !== "true")) {
    // A webhook configured for a previous bank account must not confirm new orders.
    await supabase.rpc("reset_store_sepay_webhook_key", {
      requested_store_id: membership.store_id,
    });
  }

  redirect(error ? "/dashboard/store?message=payment-settings-failed" : "/dashboard/store?message=payment-settings-updated");
}

export async function createSePayWebhookKey() {
  const { supabase, userId } = await getSessionUser();
  const { data: membership } = await supabase
    .from("store_members")
    .select("store_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) return { ok: false as const, message: "Chỉ chủ cửa hàng mới có thể thiết lập." };

  const { data: paymentSettings } = await supabase
    .from("store_payment_methods")
    .select("is_enabled")
    .eq("store_id", membership.store_id)
    .maybeSingle();
  if (!paymentSettings?.is_enabled) {
    return { ok: false as const, message: "Hãy bật thanh toán QR trước." };
  }

  const secret = randomBytes(32).toString("hex");
  const secretHash = createHash("sha256").update(secret).digest("hex");
  const { error } = await createAdminClient()
    .from("store_sepay_webhook_keys")
    .upsert({ store_id: membership.store_id, secret_hash: secretHash, enabled: false }, { onConflict: "store_id" });

  if (error) return { ok: false as const, message: "Chưa tạo được khóa kết nối. Hãy thử lại." };
  revalidatePath("/dashboard/store");
  return { ok: true as const, secret };
}

export async function updateStoreDeliverySettings(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const { data: membership } = await supabase
    .from("store_members")
    .select("store_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/dashboard/store?message=owner-required");

  const enabledText = formText(formData, "delivery_enabled");
  const radiusKm = Number(formText(formData, "delivery_radius_km"));
  const feeVnd = Number(formText(formData, "delivery_fee_vnd"));
  if (
    !["true", "false"].includes(enabledText) ||
    !Number.isFinite(radiusKm) || radiusKm < 0.5 || radiusKm > 20 ||
    !Number.isSafeInteger(feeVnd) || feeVnd < 0
  ) {
    redirect("/dashboard/store?message=invalid-delivery-settings");
  }

  const enabled = enabledText === "true";
  if (enabled) {
    const { data: store } = await supabase
      .from("stores")
      .select("id, location")
      .eq("id", membership.store_id)
      .maybeSingle();
    if (!store?.location) redirect("/dashboard/store?message=delivery-location-required");
  }

  const { error } = await supabase
    .from("stores")
    .update({
      delivery_enabled: enabled,
      delivery_radius_m: Math.round(radiusKm * 1000),
      delivery_fee_vnd: feeVnd,
    })
    .eq("id", membership.store_id);

  redirect(error ? "/dashboard/store?message=delivery-settings-failed" : "/dashboard/store?message=delivery-settings-updated");
}

export async function createCategory(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getManagedStoreId(supabase, userId);
  const name = formText(formData, "name");
  const slug = slugify(name);

  if (!name || !slug || name.length > 100) redirect("/dashboard/menu?message=invalid-category");
  const { error } = await supabase.from("categories").insert({ store_id: storeId, name, slug });
  redirect(error ? "/dashboard/menu?message=category-create-failed" : "/dashboard/menu?message=category-created");
}

export async function createPromotion(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getManagedStoreId(supabase, userId);
  const code = formText(formData, "code").toUpperCase();
  const discountType = formText(formData, "discount_type");
  const discountValue = Number(formText(formData, "discount_value"));
  const minimumSubtotal = Number(formText(formData, "minimum_subtotal_vnd") || "0");
  const usageLimitText = formText(formData, "usage_limit");
  const usageLimit = usageLimitText ? Number(usageLimitText) : null;
  const startsOn = formText(formData, "starts_on");
  const endsOn = formText(formData, "ends_on");
  const effectiveStart = startsOn || vietnamToday();

  if (
    !/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(code) ||
    !["percent", "fixed"].includes(discountType) ||
    !Number.isSafeInteger(discountValue) || discountValue < 1 ||
    (discountType === "percent" && discountValue > 100) || discountValue > 1_000_000_000 ||
    !Number.isSafeInteger(minimumSubtotal) || minimumSubtotal < 0 || minimumSubtotal > 1_000_000_000_000 ||
    (usageLimit !== null && (!Number.isSafeInteger(usageLimit) || usageLimit < 1 || usageLimit > 1_000_000)) ||
    (startsOn && !isValidDateInput(startsOn)) ||
    (endsOn && !isValidDateInput(endsOn)) ||
    (endsOn && endsOn < effectiveStart)
  ) {
    redirect("/dashboard/promotions?message=invalid-promotion");
  }

  const promotionData: {
    store_id: string;
    code: string;
    discount_type: "percent" | "fixed";
    discount_value: number;
    minimum_subtotal_vnd: number;
    usage_limit: number | null;
    ends_on: string | null;
    starts_on?: string;
  } = {
    store_id: storeId,
    code,
    discount_type: discountType as "percent" | "fixed",
    discount_value: discountValue,
    minimum_subtotal_vnd: minimumSubtotal,
    usage_limit: usageLimit,
    ends_on: endsOn || null,
  };
  if (startsOn) promotionData.starts_on = startsOn;

  const { error } = await supabase.from("store_promotions").insert(promotionData);
  redirect(error ? "/dashboard/promotions?message=promotion-create-failed" : "/dashboard/promotions?message=promotion-created");
}

export async function updatePromotionActive(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getManagedStoreId(supabase, userId);
  const promotionId = formText(formData, "promotion_id");
  const nextActive = formText(formData, "next_active");

  if (!/^[0-9a-f-]{36}$/i.test(promotionId) || !["true", "false"].includes(nextActive)) {
    redirect("/dashboard/promotions?message=invalid-promotion");
  }

  const { data, error } = await supabase
    .from("store_promotions")
    .update({ is_active: nextActive === "true" })
    .eq("id", promotionId)
    .eq("store_id", storeId)
    .select("id")
    .maybeSingle();

  redirect(error || !data
    ? "/dashboard/promotions?message=promotion-update-failed"
    : "/dashboard/promotions?message=promotion-updated");
}

export async function createProduct(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getManagedStoreId(supabase, userId);
  const name = formText(formData, "name");
  const priceVnd = Number(formText(formData, "price_vnd"));
  const categoryId = formText(formData, "category_id");
  const imageUrl = formText(formData, "image_url");
  const description = formText(formData, "description");
  const stockText = formText(formData, "stock_quantity");
  const stockQuantity = stockText === "" ? null : Number(stockText);
  const slug = slugify(name);

  if (!name || !slug || name.length > 160 || description.length > 2000 || !Number.isSafeInteger(priceVnd) || priceVnd < 0 || (stockQuantity !== null && (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 2147483647))) {
    await removeOwnedProductImage(supabase, imageUrl, storeId);
    redirect("/dashboard/menu?message=invalid-product");
  }
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
    await removeOwnedProductImage(supabase, imageUrl, storeId);
    redirect("/dashboard/menu?message=invalid-product-image");
  }

  const { error } = await supabase.from("products").insert({
    store_id: storeId,
    category_id: categoryId || null,
    name,
    slug,
    description,
    price_vnd: priceVnd,
    stock_quantity: stockQuantity,
    image_url: imageUrl || null,
    status: "active",
  });
  if (error) {
    await removeOwnedProductImage(supabase, imageUrl, storeId);
    redirect("/dashboard/menu?message=product-create-failed");
  }
  redirect("/dashboard/menu?message=product-created");
}

export async function updateProduct(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getManagedStoreId(supabase, userId);
  const productId = formText(formData, "product_id");
  const name = formText(formData, "name");
  const priceVnd = Number(formText(formData, "price_vnd"));
  const categoryId = formText(formData, "category_id");
  const imageUrl = formText(formData, "image_url");
  const description = formText(formData, "description");
  const stockText = formText(formData, "stock_quantity");
  const stockQuantity = stockText === "" ? null : Number(stockText);
  const status = formText(formData, "status");
  const slug = slugify(name);

  if (
    !productId || !name || !slug || name.length > 160 ||
    !Number.isSafeInteger(priceVnd) || priceVnd < 0 || description.length > 2000 ||
    (stockQuantity !== null && (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 2147483647)) ||
    !["active", "draft", "archived"].includes(status)
  ) {
    redirect("/dashboard/menu?message=invalid-product-update");
  }
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
    redirect("/dashboard/menu?message=invalid-product-image");
  }

  const { data: currentProduct, error: currentProductError } = await supabase
    .from("products")
    .select("image_url")
    .eq("id", productId)
    .eq("store_id", storeId)
    .maybeSingle();
  if (currentProductError || !currentProduct) redirect("/dashboard/menu?message=product-update-failed");

  const { error } = await supabase
    .from("products")
    .update({
      category_id: categoryId || null,
      name,
      slug,
      description,
      price_vnd: priceVnd,
      stock_quantity: stockQuantity,
      image_url: imageUrl || null,
      status,
    })
    .eq("id", productId)
    .eq("store_id", storeId);

  if (error) {
    if (imageUrl !== currentProduct.image_url) await removeOwnedProductImage(supabase, imageUrl, storeId);
    redirect("/dashboard/menu?message=product-update-failed");
  }

  let cleanupFailed = false;
  if (currentProduct.image_url !== (imageUrl || null)) {
    cleanupFailed = await removeOwnedProductImage(supabase, currentProduct.image_url, storeId);
  }
  redirect(cleanupFailed ? "/dashboard/menu?message=product-updated-image-cleanup-failed" : "/dashboard/menu?message=product-updated");
}

export async function saveProductOptionGroup(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  await getManagedStoreId(supabase, userId);
  const productId = formText(formData, "product_id");
  const groupId = formText(formData, "group_id");
  const name = formText(formData, "group_name");
  const selectionMode = formText(formData, "selection_mode");
  const required = formText(formData, "required") === "true";
  const optionLines = formText(formData, "options").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const options = optionLines.map((line) => {
    const separatorIndex = line.lastIndexOf("|");
    if (separatorIndex < 1) return null;
    const optionName = line.slice(0, separatorIndex).trim();
    const priceText = line.slice(separatorIndex + 1).trim();
    if (!optionName || optionName.length > 80 || !/^\d{1,10}$/.test(priceText)) return null;
    const priceAdjustment = Number(priceText);
    if (!Number.isSafeInteger(priceAdjustment) || priceAdjustment > 1_000_000_000) return null;
    return { name: optionName, price_adjustment_vnd: priceAdjustment };
  });

  if (
    !/^[0-9a-f-]{36}$/i.test(productId) ||
    (groupId && !/^[0-9a-f-]{36}$/i.test(groupId)) ||
    name.length < 1 || name.length > 80 ||
    !["single", "multiple"].includes(selectionMode) ||
    optionLines.length < 2 || optionLines.length > 20 ||
    options.some((option) => option === null)
  ) {
    redirect("/dashboard/menu?message=invalid-product-options");
  }

  const { error } = await supabase.rpc("store_save_product_option_group", {
    requested_product_id: productId,
    requested_group_id: groupId || null,
    requested_name: name,
    requested_selection_mode: selectionMode,
    requested_required: required,
    requested_options: options,
  });
  redirect(error?.message.includes("too many product option groups")
    ? "/dashboard/menu?message=product-options-limit"
    : error ? "/dashboard/menu?message=product-options-save-failed" : "/dashboard/menu?message=product-options-saved");
}

export async function deleteProductOptionGroup(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  await getManagedStoreId(supabase, userId);
  const groupId = formText(formData, "group_id");
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) redirect("/dashboard/menu?message=product-options-delete-failed");

  const { error } = await supabase.rpc("store_delete_product_option_group", {
    requested_group_id: groupId,
  });
  redirect(error ? "/dashboard/menu?message=product-options-delete-failed" : "/dashboard/menu?message=product-options-deleted");
}

export async function setProductVisibility(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getManagedStoreId(supabase, userId);
  const productId = formText(formData, "product_id");
  const status = formText(formData, "status");

  if (!/^[0-9a-f-]{36}$/i.test(productId) || !["active", "archived"].includes(status)) {
    redirect("/dashboard/menu?message=invalid-product-update");
  }

  const { data, error } = await supabase
    .from("products")
    .update({ status })
    .eq("id", productId)
    .eq("store_id", storeId)
    .select("id")
    .maybeSingle();

  if (error || !data) redirect("/dashboard/menu?message=product-visibility-failed");
  redirect(status === "active" ? "/dashboard/menu?message=product-shown" : "/dashboard/menu?message=product-hidden");
}

export async function deleteProduct(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getManagedStoreId(supabase, userId);
  const productId = formText(formData, "product_id");

  if (!/^[0-9a-f-]{36}$/i.test(productId)) redirect("/dashboard/menu?message=product-delete-failed");

  const { data: product, error: readError } = await supabase
    .from("products")
    .select("image_url")
    .eq("id", productId)
    .eq("store_id", storeId)
    .maybeSingle();
  if (readError || !product) redirect("/dashboard/menu?message=product-delete-failed");

  const { data: deleted, error: deleteError } = await supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("store_id", storeId)
    .select("id")
    .maybeSingle();
  if (deleteError || !deleted) redirect("/dashboard/menu?message=product-delete-failed");

  const cleanupFailed = await removeOwnedProductImage(supabase, product.image_url, storeId);
  redirect(cleanupFailed
    ? "/dashboard/menu?message=product-deleted-image-cleanup-failed"
    : "/dashboard/menu?message=product-deleted");
}

export async function updateOrderStatus(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getManagedStoreId(supabase, userId);
  const orderId = formText(formData, "order_id");
  const status = formText(formData, "status");
  const allowedStatuses = ["confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled", "rejected"];

  if (!orderId || !allowedStatuses.includes(status)) redirect(orderListRedirect(formData, "invalid-order-status"));

  const { error } = await supabase.rpc("store_update_order_status", {
    requested_store_id: storeId,
    requested_order_id: orderId,
    requested_status: status,
  });

  if (error) redirect(orderListRedirect(formData, "order-status-failed"));

  const notificationStatuses: OrderStatusNotice[] = [
    "confirmed",
    "preparing",
    "rejected",
    "ready",
    "out_for_delivery",
    "completed",
    "cancelled",
  ];
  if (notificationStatuses.includes(status as OrderStatusNotice)) {
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("public_code, customer_name, customer_email, total_vnd, fulfillment")
      .eq("id", orderId)
      .eq("store_id", storeId)
      .maybeSingle();
    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("name")
      .eq("id", storeId)
      .maybeSingle();

    const emailSent = !orderError && !storeError && order && store
      ? await sendOrderStatusNotice({
          customerEmail: order.customer_email,
          customerName: order.customer_name,
          storeName: store.name,
          publicCode: order.public_code,
          totalVnd: Number(order.total_vnd),
          fulfillment: order.fulfillment,
        }, status as OrderStatusNotice)
      : false;

    redirect(orderListRedirect(formData, emailSent ? "order-status-updated" : "order-status-updated-email-failed"));
  }

  redirect(orderListRedirect(formData, "order-status-updated"));
}

export async function decideOrderCancellation(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getManagedStoreId(supabase, userId);
  const orderId = formText(formData, "order_id");
  const decision = formText(formData, "decision");
  if (!orderId || (decision !== "accept" && decision !== "decline")) {
    redirect(orderListRedirect(formData, "cancellation-decision-failed"));
  }

  const { data, error } = await supabase.rpc("store_decide_order_cancellation", {
    requested_store_id: storeId,
    requested_order_id: orderId,
    accept_request: decision === "accept",
  });
  const expectedDecision = decision === "accept" ? "approved" : "declined";
  if (error || data !== expectedDecision) {
    redirect(orderListRedirect(formData, "cancellation-decision-failed"));
  }

  const [{ data: order, error: orderError }, { data: store, error: storeError }] = await Promise.all([
    supabase.from("orders")
      .select("public_code, customer_name, customer_email, total_vnd, fulfillment")
      .eq("id", orderId)
      .eq("store_id", storeId)
      .maybeSingle(),
    supabase.from("stores").select("name").eq("id", storeId).maybeSingle(),
  ]);
  const emailSent = !orderError && !storeError && order && store
    ? await sendOrderStatusNotice({
        customerEmail: order.customer_email,
        customerName: order.customer_name,
        storeName: store.name,
        publicCode: order.public_code,
        totalVnd: Number(order.total_vnd),
        fulfillment: order.fulfillment,
      }, decision === "accept" ? "cancelled" : "cancellation_request_declined")
    : false;

  if (decision === "accept") {
    redirect(orderListRedirect(formData, emailSent ? "cancellation-request-approved" : "cancellation-request-approved-email-failed"));
  }
  redirect(orderListRedirect(formData, emailSent ? "cancellation-request-declined" : "cancellation-request-declined-email-failed"));
}

export async function confirmBankTransfer(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getManagedStoreId(supabase, userId);
  const orderId = formText(formData, "order_id");
  if (!orderId) redirect(orderListRedirect(formData, "payment-confirmation-failed"));

  const { error } = await supabase.rpc("store_confirm_order_payment", {
    requested_store_id: storeId,
    requested_order_id: orderId,
  });

  if (error) redirect(orderListRedirect(formData, "payment-confirmation-failed"));

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("public_code, customer_name, customer_email, total_vnd, fulfillment")
    .eq("id", orderId)
    .eq("store_id", storeId)
    .maybeSingle();
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("name")
    .eq("id", storeId)
    .maybeSingle();

  const emailSent = !orderError && !storeError && order && store
    ? await sendOrderStatusNotice({
        customerEmail: order.customer_email,
        customerName: order.customer_name,
        storeName: store.name,
        publicCode: order.public_code,
        totalVnd: Number(order.total_vnd),
        fulfillment: order.fulfillment,
      }, "payment_confirmed")
    : false;

  redirect(orderListRedirect(formData, emailSent ? "payment-confirmed" : "payment-confirmed-email-failed"));
}

export async function updateReviewStatus(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getManagedStoreId(supabase, userId);
  const reviewId = formText(formData, "review_id");
  const status = formText(formData, "status");

  if (!reviewId || !["published", "hidden"].includes(status)) {
    redirect("/dashboard/reviews?message=invalid-review-status");
  }

  const { data: review, error } = await supabase
    .from("reviews")
    .update({ status })
    .eq("id", reviewId)
    .eq("store_id", storeId)
    .select("id")
    .maybeSingle();

  redirect(error || !review ? "/dashboard/reviews?message=review-status-failed" : "/dashboard/reviews?message=review-status-updated");
}

function normalizeHostname(value: string) {
  const ascii = domainToASCII(value.trim().replace(/\.+$/, "").toLowerCase());
  if (!ascii || ascii.length > 253 || ascii.includes("..")) return null;
  const labels = ascii.split(".");
  if (labels.length < 2 || labels.some((label) =>
    label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  )) return null;
  if (ascii === "localhost" || isIP(ascii)) return null;
  return ascii;
}

async function getOwnedStore(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: membership } = await supabase
    .from("store_members")
    .select("store_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) redirect("/dashboard/domains?message=owner-required");
  return membership.store_id;
}

export async function addStoreCustomDomain(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getOwnedStore(supabase, userId);
  const hostname = normalizeHostname(formText(formData, "hostname"));
  const platformDomain = normalizeHostname(process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? "");
  if (!hostname || (platformDomain && (hostname === platformDomain || hostname.endsWith(`.${platformDomain}`)))) {
    redirect("/dashboard/domains?message=invalid-domain");
  }

  const { error } = await supabase.from("store_domains").insert({
    store_id: storeId,
    hostname,
    domain_type: "custom",
  });
  if (error?.code === "23505") redirect("/dashboard/domains?message=domain-taken");
  if (error) redirect("/dashboard/domains?message=domain-add-failed");
  revalidatePath("/dashboard/domains");
  redirect("/dashboard/domains?message=domain-added");
}

export async function verifyStoreCustomDomain(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getOwnedStore(supabase, userId);
  const domainId = formText(formData, "domain_id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(domainId)) redirect("/dashboard/domains?message=invalid-domain");

  const { data: domain } = await supabase
    .from("store_domains")
    .select("id, hostname, verification_status, verification_token")
    .eq("id", domainId)
    .eq("store_id", storeId)
    .eq("domain_type", "custom")
    .maybeSingle();
  if (!domain) redirect("/dashboard/domains?message=domain-not-found");
  if (domain.verification_status === "verified") redirect("/dashboard/domains?message=domain-already-verified");

  const cnameTarget = normalizeHostname(process.env.STORE_DOMAIN_CNAME_TARGET ?? "");
  if (!cnameTarget) redirect("/dashboard/domains?message=domain-target-not-configured");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) redirect("/dashboard/domains?message=domain-service-key-missing");

  const challengeName = `_foodgo-verification.${domain.hostname}`;
  let hasTxtChallenge = false;
  let hasCnameTarget = false;
  try {
    const [txtRecords, cnameRecords] = await Promise.all([
      resolveTxt(challengeName),
      resolveCname(domain.hostname),
    ]);
    hasTxtChallenge = txtRecords.some((record) => record.join("") === `foodgo-verify=${domain.verification_token}`);
    hasCnameTarget = cnameRecords.some((record) => normalizeHostname(record) === cnameTarget);
  } catch {
    redirect("/dashboard/domains?message=domain-dns-pending");
  }
  if (!hasTxtChallenge || !hasCnameTarget) redirect("/dashboard/domains?message=domain-dns-pending");

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    redirect("/dashboard/domains?message=domain-service-key-missing");
  }
  const { error } = await admin
    .from("store_domains")
    .update({ verification_status: "verified" })
    .eq("id", domain.id)
    .eq("store_id", storeId);
  if (error) redirect("/dashboard/domains?message=domain-verify-failed");
  revalidatePath("/dashboard/domains");
  redirect("/dashboard/domains?message=domain-verified");
}

export async function removeStoreCustomDomain(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getOwnedStore(supabase, userId);
  const domainId = formText(formData, "domain_id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(domainId)) redirect("/dashboard/domains?message=invalid-domain");
  const { error } = await supabase
    .from("store_domains")
    .delete()
    .eq("id", domainId)
    .eq("store_id", storeId)
    .eq("domain_type", "custom");
  if (error) redirect("/dashboard/domains?message=domain-remove-failed");
  revalidatePath("/dashboard/domains");
  redirect("/dashboard/domains?message=domain-removed");
}
