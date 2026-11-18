"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "node:crypto";
import { resolveCname, resolveTxt } from "node:dns/promises";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { getBankByCode } from "@viet-qr/core";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { requireMerchantPremium } from "@/lib/merchant-billing";
import { requireMerchantAccount } from "@/lib/platform-account";
import {
  getStoreBannerUrls,
  isStoreThemePreset,
  isStorefrontLayoutPreset,
  isStorefrontSection,
  isStorefrontStyle,
  storefrontSectionIds,
} from "@/lib/store-appearance";
import { sendOrderStatusNotice, type OrderStatusNotice } from "@/lib/email/order-status";
import { getMerchantContext } from "./data";
import { getActiveMembership, activeStoreCookie, requireExpectedStore } from "@/lib/active-store";
import { cookies } from "next/headers";
import type { OrderHours } from "@/lib/store-order-hours";

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
  const payment = formText(formData, "filter_payment");
  if (["cash_on_pickup", "cash_on_delivery", "bank_transfer"].includes(payment)) params.set("payment", payment);
  for (const field of ["from", "to"] as const) { const value = formText(formData, `filter_${field}`); if (isValidDateInput(value)) params.set(field, value); }
  for (const field of ["min", "max"] as const) { const value = formText(formData, `filter_${field}`); if (/^\d{1,15}$/.test(value)) params.set(field, value); }
  const sort = formText(formData, "filter_sort");
  if (["newest", "oldest", "amount_high", "amount_low"].includes(sort)) params.set("sort", sort);
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

async function getSessionUser(formData?: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (!userId) redirect("/login");
  await requireMerchantAccount(supabase);
  if (formData) {
    const membership = await getActiveMembership(supabase, userId);
    if (!membership) redirect("/dashboard");
    requireExpectedStore(formData, membership.store_id);
  }
  return { supabase, userId };
}

async function getManagedStoreId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const membership = await getActiveMembership(supabase, userId);

  if (!membership) redirect("/dashboard");
  return membership.store_id;
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(activeStoreCookie);
  redirect("/login");
}

export async function changeAccountPassword(
  _previous: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const { supabase } = await getSessionUser();
  const current = formData.get("current_password");
  const password = formData.get("new_password");
  const confirmation = formData.get("confirm_password");

  if (typeof current !== "string" || !current || typeof password !== "string" || password.length < 8) {
    return { error: "Nhập mật khẩu hiện tại và ít nhất 8 ký tự cho mật khẩu mới." };
  }
  if (password !== confirmation) return { error: "Mật khẩu xác nhận chưa khớp." };
  if (password === current) return { error: "Mật khẩu mới phải khác mật khẩu hiện tại." };

  const { error } = await supabase.auth.updateUser({ password, current_password: current });
  if (error?.code === "reauthentication_needed") return { error: "Hãy đăng nhập lại rồi thử đổi mật khẩu." };
  if (error?.code === "invalid_credentials") return { error: "Mật khẩu hiện tại chưa đúng." };
  if (error?.code === "weak_password") return { error: "Mật khẩu mới chưa đáp ứng yêu cầu bảo mật." };
  if (error) return { error: "Chưa đổi được mật khẩu. Vui lòng kiểm tra mật khẩu hiện tại và thử lại." };
  return { success: true };
}

export async function createStore(formData: FormData) {
  const { supabase } = await getSessionUser();
  const categoryId = formText(formData, "business_category_id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryId)) redirect("/dashboard?message=invalid-business-category");
  const name = formText(formData, "name");
  const phone = formText(formData, "phone");
  const address = formText(formData, "address");
  const slug = slugify(formText(formData, "slug") || name);
  const latitudeText = formText(formData, "latitude");
  const longitudeText = formText(formData, "longitude");

  if (name.length < 2 || name.length > 120 || !slug || slug.length > 80) redirect("/dashboard?message=invalid-store");
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

  const { error } = await supabase.rpc("create_store_with_merchant_plan", {
    category_id: categoryId,
    store_name: name,
    store_slug: slug,
    store_phone: phone || null,
    store_address: address || null,
    store_location: location,
  });
  if (error?.message === "invalid_business_category") redirect("/dashboard?message=invalid-business-category");
  if (error?.message === "active_plan_required") redirect("/merchant-plan");
  if (error?.message === "reserved_store_slug") redirect("/dashboard?message=invalid-reserved-store-slug");
  if (error) redirect("/dashboard?message=store-create-failed");
  revalidatePath("/dashboard");
  redirect("/dashboard?message=store-created");
}

export async function updateStoreLocation(formData: FormData) {
  const { supabase, userId } = await getSessionUser(formData);
  const activeMembership = await getActiveMembership(supabase, userId);
  const membership = activeMembership?.role === "owner" ? activeMembership : null;

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
  const { supabase, userId } = await getSessionUser(formData);
  const activeMembership = await getActiveMembership(supabase, userId);
  const membership = activeMembership?.role === "owner" ? activeMembership : null;

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
  const { supabase, userId } = await getSessionUser(formData);
  const activeMembership = await getActiveMembership(supabase, userId);
  const membership = activeMembership?.role === "owner" ? activeMembership : null;

  if (!membership) redirect("/dashboard/store?message=owner-required");
  await requireMerchantPremium(supabase, membership.store_id);

  const rawLogoUrl = formText(formData, "logo_url");
  const rawBannerUrl = formText(formData, "banner_url");
  const slideshowSubmitted = formData.get("banner_slideshow") === "true";
  const submittedBanners = formData.getAll("banner_urls").map((value) => String(value).trim());
  const theme = formText(formData, "theme_preset");
  const style = formData.get("storefront_style");
  const layout = formText(formData, "storefront_layout");
  const sectionOrder = formData.getAll("storefront_section_order").map((value) => String(value));
  const hiddenSections = [...new Set(formData.getAll("storefront_hidden_sections").map((value) => String(value)))];
  const [{ data: store }, bannerResult] = await Promise.all([supabase
    .from("stores")
    .select("id, slug, logo_url, banner_url, updated_at")
    .eq("id", membership.store_id)
    .maybeSingle(),
    supabase.from("stores").select("banner_urls").eq("id", membership.store_id).maybeSingle(),
  ]);
  if (!store) redirect("/dashboard/appearance?message=store-appearance-save-failed");
  const galleryUnavailable = bannerResult.error?.code === "42703" || bannerResult.error?.code === "PGRST204";
  if (slideshowSubmitted && galleryUnavailable) redirect("/dashboard/appearance?message=store-banner-migration-required");
  if (bannerResult.error && !galleryUnavailable) redirect("/dashboard/appearance?message=store-appearance-save-failed");
  if (formData.has("appearance_version") && formText(formData, "appearance_version") !== store.updated_at) {
    redirect("/dashboard/appearance?message=store-appearance-changed");
  }

  const logoUrl = rawLogoUrl || null;
  const previousBanners = getStoreBannerUrls(bannerResult.data?.banner_urls, store.banner_url);
  const bannerUrls = slideshowSubmitted
    ? submittedBanners
    : rawBannerUrl ? [...new Set([rawBannerUrl, ...previousBanners.filter((url) => url !== store.banner_url)])] : [];
  const bannerUrl = bannerUrls[0] ?? null;
  const validOrder = sectionOrder.length === storefrontSectionIds.length
    && new Set(sectionOrder).size === storefrontSectionIds.length
    && sectionOrder.every(isStorefrontSection)
    && storefrontSectionIds.every((section) => sectionOrder.includes(section));
  const validHiddenSections = hiddenSections.every((section) => isStorefrontSection(section) && section !== "menu");
  const validLogo = rawLogoUrl.length <= 2048 && (!rawLogoUrl || rawLogoUrl === store.logo_url || Boolean(getOwnedStoreAppearanceAssetPath(rawLogoUrl, store.id, "logo")));
  const validBanner = bannerUrls.length <= 3 && new Set(bannerUrls).size === bannerUrls.length
    && bannerUrls.every((url) => url.length > 0 && url.length <= 2048
      && (previousBanners.includes(url) || Boolean(getOwnedStoreAppearanceAssetPath(url, store.id, "banner"))));
  if (
    !validLogo || !validBanner || !isStoreThemePreset(theme) || (style !== null && !isStorefrontStyle(style)) || !isStorefrontLayoutPreset(layout) ||
    !validOrder || !validHiddenSections
  ) {
    redirect("/dashboard/appearance?message=invalid-store-appearance");
  }

  const { data: savedStore, error } = await supabase
    .from("stores")
    .update({
      logo_url: logoUrl,
      banner_url: bannerUrl,
      ...(slideshowSubmitted ? { banner_urls: bannerUrls } : {}),
      theme_preset: theme,
      ...(style === null ? {} : { storefront_style: style }),
      storefront_layout: layout,
      storefront_section_order: sectionOrder,
      storefront_hidden_sections: hiddenSections,
    })
    .eq("id", store.id).eq("updated_at", store.updated_at)
    .select("id").maybeSingle();
  if (error) redirect("/dashboard/appearance?message=store-appearance-save-failed");
  if (!savedStore) redirect("/dashboard/appearance?message=store-appearance-changed");

  revalidatePath(`/${store.slug}`);
  revalidatePath(`/store-host/${store.slug}`);
  revalidatePath("/dashboard/appearance");

  let cleanupFailed = false;
  for (const [kind, previousUrl] of [
    ...(store.logo_url && store.logo_url !== logoUrl ? [["logo", store.logo_url] as const] : []),
    ...previousBanners.filter((url) => !bannerUrls.includes(url)).map((url) => ["banner", url] as const),
  ]) {
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
  const { supabase, userId } = await getSessionUser(formData);
  const activeMembership = await getActiveMembership(supabase, userId);
  const membership = activeMembership?.role === "owner" ? activeMembership : null;

  if (!membership) redirect("/dashboard/store?message=owner-required");

  const requestedValue = formText(formData, "accepts_orders");
  if (!["true", "false"].includes(requestedValue)) {
    redirect("/dashboard/store?message=invalid-store-order-setting");
  }

  const acceptsOrders = requestedValue === "true";
  const { data, error } = await supabase
    .from("stores")
    .update({ accepts_orders: acceptsOrders })
    .eq("id", membership.store_id)
    .select("id")
    .maybeSingle();

  if (error || !data) redirect("/dashboard/store?message=store-order-setting-failed");
  redirect(acceptsOrders ? "/dashboard/store?message=store-orders-enabled" : "/dashboard/store?message=store-orders-paused");
}

export async function updateStoreOrderHours(formData: FormData) {
  const { supabase, membership, store } = await getMerchantContext();
  if (!store || membership?.role !== "owner") redirect("/dashboard/store?message=owner-required");
  requireExpectedStore(formData, store.id);

  let hours: OrderHours | null = null;
  if (formData.has("schedule_enabled")) {
    hours = [];
    for (let day = 0; day < 7; day++) {
      if (!formData.has(`day_${day}`)) {
        hours.push(null);
        continue;
      }
      const opens = formText(formData, `opens_${day}`);
      const closes = formText(formData, `closes_${day}`);
      const timeFormat = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
      if (!timeFormat.test(opens) || !timeFormat.test(closes) || opens === closes) {
        redirect("/dashboard/store?message=invalid-store-order-hours#order-hours");
      }
      const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      hours.push([minutes(opens), minutes(closes)]);
    }
  }

  const { data, error } = await supabase.from("stores").update({ order_hours: hours })
    .eq("id", store.id).select("id").maybeSingle();
  redirect(`/dashboard/store?message=${error || !data ? "store-order-hours-failed" : "store-order-hours-updated"}#order-hours`);
}

export async function updateStorePaymentSettings(formData: FormData) {
  const { supabase, userId } = await getSessionUser(formData);
  const activeMembership = await getActiveMembership(supabase, userId);
  const membership = activeMembership?.role === "owner" ? activeMembership : null;

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

export async function createSePayWebhookKey(expectedStoreId: string) {
  const { supabase, userId } = await getSessionUser();
  const activeMembership = await getActiveMembership(supabase, userId);
  const membership = activeMembership?.role === "owner" ? activeMembership : null;

  if (!membership) return { ok: false as const, message: "Chỉ chủ cửa hàng mới có thể thiết lập." };
  if (membership.store_id !== expectedStoreId) return { ok: false as const, message: "Cửa hàng đang làm việc đã thay đổi. Hãy tải lại trang." };

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
  const { supabase, userId } = await getSessionUser(formData);
  const activeMembership = await getActiveMembership(supabase, userId);
  const membership = activeMembership?.role === "owner" ? activeMembership : null;

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

function getCategoryImagePath(url: string | null, storeId: string) {
  const path = getOwnedProductImagePath(url, storeId);
  return path && /^category-[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path.split("/")[1]) ? path : null;
}

export async function saveCategory(
  categoryId: string | null,
  previousImage: string | null,
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const { supabase, userId } = await getSessionUser(formData);
  const storeId = await getManagedStoreId(supabase, userId);
  const name = formText(formData, "name");
  const slug = slugify(name);
  const imageUrl = formText(formData, "image_url");
  if (!name || !slug || name.length > 100) return "Hãy nhập tên danh mục hợp lệ.";
  const changeImage = formData.has("image_url") && (imageUrl || null) !== previousImage;
  if (changeImage && imageUrl && !getCategoryImagePath(imageUrl, storeId)) return "Hãy tải ảnh danh mục từ thiết bị của bạn.";
  const fields = { name, slug, ...(changeImage ? { image_url: imageUrl || null } : {}) };
  let update = categoryId
    ? supabase.from("categories").update(fields).eq("store_id", storeId).eq("id", categoryId)
    : null;
  if (update && changeImage) {
    update = previousImage === null ? update.is("image_url", null) : update.eq("image_url", previousImage);
  }
  const { data, error } = update
    ? await update.select("id").maybeSingle()
    : await supabase.from("categories").insert({ store_id: storeId, ...fields }).select("id").single();
  if (error?.code === "23505") return "Tên danh mục này đã được dùng. Hãy chọn tên khác.";
  if (error || !data) return "Chưa lưu được danh mục. Vui lòng tải lại trang và thử lại.";

  const cleanupFailed = categoryId && changeImage && getCategoryImagePath(previousImage, storeId)
    ? await removeOwnedProductImage(supabase, previousImage, storeId)
    : false;
  const message = cleanupFailed ? "category-image-cleanup-failed" : categoryId ? "category-updated" : "category-created";
  revalidatePath("/dashboard/menu");
  redirect(`/dashboard/menu?message=${message}`);
}

export async function deleteCategory(categoryId: string, _previous: string | null, formData: FormData): Promise<string | null> {
  const { supabase, userId } = await getSessionUser(formData);
  const storeId = await getManagedStoreId(supabase, userId);
  const { data, error } = await supabase.from("categories").delete()
    .eq("store_id", storeId).eq("id", categoryId).select().maybeSingle();

  if (error?.code === "23503") return "Danh mục vẫn còn sản phẩm. Hãy chuyển sản phẩm sang danh mục khác hoặc chọn Chưa phân loại trước khi xóa.";
  if (error || !data) return "Chưa xóa được danh mục. Vui lòng tải lại trang và thử lại.";

  const imageUrl = typeof data.image_url === "string" ? data.image_url : null;
  const cleanupFailed = getCategoryImagePath(imageUrl, storeId)
    ? await removeOwnedProductImage(supabase, imageUrl, storeId)
    : false;
  revalidatePath("/dashboard/menu");
  redirect(cleanupFailed ? "/dashboard/menu?message=category-delete-image-cleanup-failed" : "/dashboard/menu?message=category-deleted");
}

export async function createPromotion(formData: FormData) {
  const { supabase, userId } = await getSessionUser(formData);
  const storeId = await getManagedStoreId(supabase, userId);
  await requireMerchantPremium(supabase, storeId);
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
  const { supabase, userId } = await getSessionUser(formData);
  const storeId = await getManagedStoreId(supabase, userId);
  await requireMerchantPremium(supabase, storeId);
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
  const { supabase, userId } = await getSessionUser(formData);
  const storeId = await getManagedStoreId(supabase, userId);
  const name = formText(formData, "name");
  const priceVnd = Number(formText(formData, "price_vnd"));
  const categoryId = formText(formData, "category_id");
  const brandId = formText(formData, "brand_id");
  const variantsText = formText(formData, "variants_json");
  const imageUrl = formText(formData, "image_url");
  const description = formText(formData, "description");
  const stockText = formText(formData, "stock_quantity");
  const stockQuantity = stockText === "" ? null : Number(stockText);
  const lowStockThreshold = formData.has("low_stock_threshold") ? Number(formText(formData, "low_stock_threshold") || "5") : null;
  const slug = slugify(name);

  if (!name || !slug || name.length > 160 || description.length > 2000 || !Number.isSafeInteger(priceVnd) || priceVnd < 0 || (stockQuantity !== null && (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 2147483647)) ||
      (lowStockThreshold !== null && (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0 || lowStockThreshold > 2147483647))) {
    await removeOwnedProductImage(supabase, imageUrl, storeId);
    redirect("/dashboard/menu?message=invalid-product");
  }
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
    await removeOwnedProductImage(supabase, imageUrl, storeId);
    redirect("/dashboard/menu?message=invalid-product-image");
  }

  if (variantsText) {
    let variants: unknown;
    try { variants = JSON.parse(variantsText); } catch { redirect("/dashboard/menu?message=invalid-variants"); }
    if (!Array.isArray(variants) || variants.length < 1 || variants.length > 80 || variantsText.length > 100000) redirect("/dashboard/menu?message=invalid-variants");
    const result = await supabase.rpc("create_product_with_variant_drafts", { target_store: storeId, product_name: name, product_slug: slug, product_category: categoryId || null, product_brand: brandId || null, product_description: description, product_image: imageUrl || null, product_price: priceVnd, product_low_stock: lowStockThreshold ?? 5, requested_variants: variants });
    if (result.error) { await removeOwnedProductImage(supabase, imageUrl, storeId); redirect("/dashboard/menu?message=variant-create-failed"); }
    redirect("/dashboard/menu?message=variant-product-created");
  }
  const { error } = await supabase.from("products").insert({
    store_id: storeId,
    category_id: categoryId || null,
    brand_id: brandId || null,
    name,
    slug,
    description,
    price_vnd: priceVnd,
    stock_quantity: stockQuantity,
    ...(lowStockThreshold === null ? {} : { low_stock_threshold: lowStockThreshold }),
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
  const { supabase, userId } = await getSessionUser(formData);
  const storeId = await getManagedStoreId(supabase, userId);
  const productId = formText(formData, "product_id");
  const name = formText(formData, "name");
  const priceVnd = Number(formText(formData, "price_vnd"));
  const categoryId = formText(formData, "category_id");
  const imageUrl = formText(formData, "image_url");
  const description = formText(formData, "description");
  const stockText = formText(formData, "stock_quantity");
  const stockQuantity = stockText === "" ? null : Number(stockText);
  const lowStockThreshold = formData.has("low_stock_threshold") ? Number(formText(formData, "low_stock_threshold") || "5") : null;
  const status = formText(formData, "status");
  const slug = slugify(name);

  if (
    !productId || !name || !slug || name.length > 160 ||
    !Number.isSafeInteger(priceVnd) || priceVnd < 0 || description.length > 2000 ||
    (stockQuantity !== null && (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 2147483647)) ||
    (lowStockThreshold !== null && (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0 || lowStockThreshold > 2147483647)) ||
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
      ...(lowStockThreshold === null ? {} : { low_stock_threshold: lowStockThreshold }),
      image_url: imageUrl || null,
      status,
    })
    .eq("id", productId)
    .eq("store_id", storeId);

  if (error) {
    if (imageUrl !== currentProduct.image_url) await removeOwnedProductImage(supabase, imageUrl, storeId);
    redirect(error.message.includes("variant_checkout_not_ready") ? "/dashboard/menu?message=variant-not-ready" : "/dashboard/menu?message=product-update-failed");
  }

  let cleanupFailed = false;
  if (currentProduct.image_url !== (imageUrl || null)) {
    cleanupFailed = await removeOwnedProductImage(supabase, currentProduct.image_url, storeId);
  }
  redirect(cleanupFailed ? "/dashboard/menu?message=product-updated-image-cleanup-failed" : "/dashboard/menu?message=product-updated");
}

export async function saveProductOptionGroup(formData: FormData) {
  const { supabase, userId } = await getSessionUser(formData);
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
  const { supabase, userId } = await getSessionUser(formData);
  await getManagedStoreId(supabase, userId);
  const groupId = formText(formData, "group_id");
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) redirect("/dashboard/menu?message=product-options-delete-failed");

  const { error } = await supabase.rpc("store_delete_product_option_group", {
    requested_group_id: groupId,
  });
  redirect(error ? "/dashboard/menu?message=product-options-delete-failed" : "/dashboard/menu?message=product-options-deleted");
}

export async function setProductVisibility(formData: FormData) {
  const { supabase, userId } = await getSessionUser(formData);
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

  if (error?.message.includes("variant_checkout_not_ready")) redirect("/dashboard/menu?message=variant-not-ready");
  if (error || !data) redirect("/dashboard/menu?message=product-visibility-failed");
  redirect(status === "active" ? "/dashboard/menu?message=product-shown" : "/dashboard/menu?message=product-hidden");
}

export async function deleteProduct(formData: FormData) {
  const { supabase, userId } = await getSessionUser(formData);
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
  const { supabase, userId } = await getSessionUser(formData);
  const storeId = await getManagedStoreId(supabase, userId);
  const orderId = formText(formData, "order_id");
  const requestedStatus = formText(formData, "status");
  const allowedStatuses = ["confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled", "rejected"] as const satisfies readonly OrderStatusNotice[];
  const status = allowedStatuses.find((value) => value === requestedStatus);

  if (!orderId || !status) redirect(orderListRedirect(formData, "invalid-order-status"));

  const estimate = formText(formData, "preparation_minutes");
  if (estimate && (status !== "confirmed" || !["15", "30", "45"].includes(estimate))) {
    redirect(orderListRedirect(formData, "invalid-order-ready-estimate"));
  }
  const orderParams = { requested_store_id: storeId, requested_order_id: orderId };
  const { error } = estimate
    ? await supabase.rpc("store_set_pickup_ready_estimate", { ...orderParams, requested_minutes: Number(estimate), confirm_order: true })
    : await supabase.rpc("store_update_order_status", { ...orderParams, requested_status: status });

  if (error) redirect(orderListRedirect(formData, "order-status-failed"));

  after(async () => {
    const [{ data: order, error: orderError }, { data: store, error: storeError }] = await Promise.all([
      supabase.from("orders").select("public_code, customer_name, customer_email, total_vnd, fulfillment")
        .eq("id", orderId).eq("store_id", storeId).maybeSingle(),
      supabase.from("stores").select("name").eq("id", storeId).maybeSingle(),
    ]);
    if (orderError || storeError || !order || !store) {
      console.warn("Could not load details for order status email", { orderId, status, code: orderError?.code ?? storeError?.code });
      return;
    }
    if (!order.customer_email) return;
    const sent = await sendOrderStatusNotice({
      customerEmail: order.customer_email,
      customerName: order.customer_name,
      storeName: store.name,
      publicCode: order.public_code,
      totalVnd: Number(order.total_vnd),
      fulfillment: order.fulfillment,
    }, status);
    if (!sent) console.warn("Could not send order status email", { orderId, status });
  });

  redirect(orderListRedirect(formData, "order-status-updated"));
}

export async function updateOrderReadyEstimate(formData: FormData) {
  const { supabase, userId } = await getSessionUser(formData);
  const storeId = await getManagedStoreId(supabase, userId);
  const orderId = formText(formData, "order_id");
  const minutes = formText(formData, "preparation_minutes");
  if (!orderId || !["15", "30", "45"].includes(minutes)) {
    redirect(orderListRedirect(formData, "invalid-order-ready-estimate"));
  }
  const { error } = await supabase.rpc("store_set_pickup_ready_estimate", {
    requested_store_id: storeId, requested_order_id: orderId,
    requested_minutes: Number(minutes), confirm_order: false,
  });
  redirect(orderListRedirect(formData, error ? "order-ready-estimate-failed" : "order-ready-estimate-updated"));
}

export async function sendCurrentOrderNotice(formData: FormData) {
  const { supabase, userId } = await getSessionUser(formData);
  const storeId = await getManagedStoreId(supabase, userId);
  const orderId = formText(formData, "order_id");
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) redirect(orderListRedirect(formData, "order-notice-failed"));
  const [{ data: order }, { data: store }] = await Promise.all([
    supabase.from("orders").select("public_code, customer_name, customer_email, total_vnd, fulfillment, status").eq("id", orderId).eq("store_id", storeId).maybeSingle(),
    supabase.from("stores").select("name").eq("id", storeId).maybeSingle(),
  ]);
  const allowed = ["confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled", "rejected"] as const satisfies readonly OrderStatusNotice[];
  const notice = allowed.find((status) => status === order?.status);
  if (!order || !store || !notice || !order.customer_email) redirect(orderListRedirect(formData, "order-notice-failed"));
  const sent = await sendOrderStatusNotice({ customerEmail: order.customer_email, customerName: order.customer_name, storeName: store.name, publicCode: order.public_code, totalVnd: Number(order.total_vnd), fulfillment: order.fulfillment }, notice);
  redirect(orderListRedirect(formData, sent ? "order-notice-sent" : "order-notice-failed"));
}

export async function decideOrderCancellation(formData: FormData) {
  const { supabase, userId } = await getSessionUser(formData);
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

export async function recordOrderRefund(formData: FormData) {
  const { supabase, userId } = await getSessionUser(formData);
  const storeId = await getManagedStoreId(supabase, userId);
  const orderId = formText(formData, "order_id");
  if (!orderId) redirect(orderListRedirect(formData, "order-refund-failed"));

  const { error } = await supabase.rpc("store_record_order_refund", {
    requested_store_id: storeId,
    requested_order_id: orderId,
  });
  if (error) redirect(orderListRedirect(formData, "order-refund-failed"));

  revalidatePath("/dashboard/orders");
  redirect(orderListRedirect(formData, "order-refund-recorded"));
}

export async function confirmBankTransfer(formData: FormData) {
  const { supabase, userId } = await getSessionUser(formData);
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
  const { supabase, userId } = await getSessionUser(formData);
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
  const activeMembership = await getActiveMembership(supabase, userId);
  const membership = activeMembership?.role === "owner" ? activeMembership : null;
  if (!membership) redirect("/dashboard/domains?message=owner-required");
  return membership.store_id;
}

export async function addStoreCustomDomain(formData: FormData) {
  const { supabase, userId } = await getSessionUser(formData);
  const storeId = await getOwnedStore(supabase, userId);
  await requireMerchantPremium(supabase, storeId);
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
  const { supabase, userId } = await getSessionUser(formData);
  const storeId = await getOwnedStore(supabase, userId);
  await requireMerchantPremium(supabase, storeId);
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
  const { supabase, userId } = await getSessionUser(formData);
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
