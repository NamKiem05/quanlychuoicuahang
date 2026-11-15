"use server";

import { redirect } from "next/navigation";
import { getBankByCode } from "@viet-qr/core";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { sendOrderStatusNotice, type OrderStatusNotice } from "@/lib/email/order-status";

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function orderListRedirect(formData: FormData, message: string) {
  const params = new URLSearchParams({ message });
  const query = formText(formData, "filter_query").replace(/[^\p{L}\p{N}\s+-]/gu, "").slice(0, 60).trim();
  const status = formText(formData, "filter_status");
  const validStatuses = ["pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled", "rejected"];
  if (query) params.set("q", query);
  if (validStatuses.includes(status)) params.set("filter_status", status);
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

  const { error } = await supabase.from("store_payment_methods").upsert({
    store_id: membership.store_id,
    bank_code: bank.code,
    bank_name: bank.fullName,
    account_number: accountNumber,
    account_name: accountName,
    is_enabled: enabledText === "true",
  }, { onConflict: "store_id" });

  redirect(error ? "/dashboard/store?message=payment-settings-failed" : "/dashboard/store?message=payment-settings-updated");
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

export async function createProduct(formData: FormData) {
  const { supabase, userId } = await getSessionUser();
  const storeId = await getManagedStoreId(supabase, userId);
  const name = formText(formData, "name");
  const priceVnd = Number(formText(formData, "price_vnd"));
  const categoryId = formText(formData, "category_id");
  const imageUrl = formText(formData, "image_url");
  const description = formText(formData, "description");
  const slug = slugify(name);

  if (!name || !slug || name.length > 160 || description.length > 2000 || !Number.isSafeInteger(priceVnd) || priceVnd < 0) {
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
  const status = formText(formData, "status");
  const slug = slugify(name);

  if (
    !productId || !name || !slug || name.length > 160 ||
    !Number.isSafeInteger(priceVnd) || priceVnd < 0 || description.length > 2000 ||
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
