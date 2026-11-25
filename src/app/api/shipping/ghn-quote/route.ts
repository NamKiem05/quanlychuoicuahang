import { createHash, randomUUID } from "node:crypto";
import { readLimitedJson } from "@/lib/http/read-limited-json";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptGhnToken, ghnLocations, ghnShipmentRequest } from "@/lib/shipping/ghn";
import { consumeGhnQuoteRateLimit, getGhnQuoteIpHash } from "@/lib/shipping/ghn-quote-rate-limit";
import { choosePackaging, parseStoredDimensions } from "@/lib/shipping/packaging";
import provinces from "@/lib/vietnam-checkout-addresses.json";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const normalizeLocation = (name: string) => name.trim().toLocaleLowerCase("vi").replace(/^(tỉnh|thành phố|phường|xã|đặc khu)\s+/u, "");
const maxBodyBytes = 64 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export async function POST(request: Request) {
  const unavailable = (message: string, status = 422) => Response.json({ message }, { status });
  let input: unknown;
  try { input = await readLimitedJson(request, maxBodyBytes); }
  catch (error) { return unavailable("Nội dung yêu cầu không hợp lệ hoặc quá lớn.", error instanceof Error && error.message === "BODY_TOO_LARGE" ? 413 : 400); }
  if (!isRecord(input) || typeof input.slug !== "string" || !/^[a-z0-9-]{1,80}$/.test(input.slug) ||
    typeof input.detail !== "string" || input.detail.trim().length < 1 || input.detail.length > 400 ||
    !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 30) {
    return unavailable("Thông tin báo phí GHN chưa hợp lệ.", 400);
  }
  const items = input.items as { product_id: string; quantity: number; option_ids?: string[]; variant_id?: string }[];
  if (!items.every((item) => isRecord(item) && typeof item.product_id === "string" && uuid.test(item.product_id) &&
    Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 20 &&
    Array.isArray(item.option_ids) && item.option_ids.length <= 40 && item.option_ids.every((id) => typeof id === "string" && uuid.test(id)) &&
    (item.variant_id === undefined || (typeof item.variant_id === "string" && uuid.test(item.variant_id))))) {
    return unavailable("Giỏ hàng chưa hợp lệ.", 400);
  }
  const province = provinces.find((item) => item.code === input.province);
  const ward = province?.wards.find((item) => item.code === input.ward);
  if (!province || !ward) return unavailable("Chọn tỉnh/thành và phường/xã để lấy phí GHN.", 400);
  const address = [input.detail.trim(), ward.name, province.name].join(", ");

  try {
    const ipHash = getGhnQuoteIpHash(request);
    const admin = createAdminClient();
    const store = await admin.from("stores").select("id").eq("slug", input.slug)
      .eq("status", "active").eq("accepts_orders", true).eq("delivery_enabled", true).maybeSingle();
    if (store.error || !store.data) return unavailable("Cửa hàng chưa nhận đơn giao tận nơi.", 404);
    const storeId = store.data.id;
    const rate = await consumeGhnQuoteRateLimit(admin, ipHash, storeId);
    if (!rate.allowed) return Response.json({ message: "Bạn đã gửi quá nhiều yêu cầu báo phí. Vui lòng chờ một chút rồi thử lại." }, {
      status: 429, headers: { "Retry-After": String(rate.retryAfter) },
    });
    const variantIds = [...new Set(items.flatMap((item) => item.variant_id ? [item.variant_id] : []))];
    const [connection, packaging, products, variants] = await Promise.all([
      admin.from("store_ghn_connections").select("shop_id,token_ciphertext").eq("store_id", storeId).eq("environment", "staging").maybeSingle(),
      admin.from("store_ghn_packaging").select("id,name,kind,packing_rule,weight_g,length_cm,width_cm,height_cm").eq("store_id", storeId),
      admin.from("products").select("id,shipping_dimensions,variants_enabled").eq("store_id", storeId).eq("status", "active")
        .in("id", [...new Set(items.map((item) => item.product_id))]),
      variantIds.length
        ? admin.from("product_variant_drafts").select("id,product_id,shipping_dimensions")
          .eq("store_id", storeId).in("id", variantIds)
        : { data: [], error: null },
    ]);
    if (connection.error || packaging.error || products.error || variants.error || !connection.data || !packaging.data.length) {
      return unavailable("Cửa hàng chưa sẵn sàng báo phí GHN.", 503);
    }

    const productsById = new Map(products.data.map((item) => [item.id, item]));
    const variantsById = new Map(variants.data.map((item) => [item.id, item]));
    const parcelItems = [];
    for (const item of items) {
      const product = productsById.get(item.product_id);
      const variant = item.variant_id ? variantsById.get(item.variant_id) : undefined;
      if (!product || (product.variants_enabled
        ? variant?.product_id !== product.id
        : item.variant_id !== undefined)) {
        return unavailable("Sản phẩm hoặc biến thể đã thay đổi. Hãy chọn lại trong giỏ hàng.");
      }
      const dimensions = parseStoredDimensions(product.variants_enabled ? variant?.shipping_dimensions : product.shipping_dimensions);
      if (!dimensions) {
        return unavailable(product.variants_enabled
          ? "Có biến thể chưa được cửa hàng khai báo thông số vận chuyển."
          : "Có sản phẩm chưa được cửa hàng khai báo thông số vận chuyển.");
      }
      parcelItems.push({ dimensions, quantity: item.quantity });
    }
    const packed = choosePackaging(packaging.data, parcelItems);
    if (!packed) return unavailable("Giỏ hàng vượt kích thước hoặc khối lượng của các bao bì GHN hiện có. Hãy giảm số lượng hoặc chia thành nhiều đơn.");
    const { parcel, profile } = packed;

    const shopId = Number(connection.data.shop_id);
    if (!Number.isSafeInteger(shopId) || shopId < 1 || typeof connection.data.token_ciphertext !== "string") return unavailable("Cửa hàng chưa sẵn sàng báo phí GHN.", 503);
    const token = decryptGhnToken(connection.data.token_ciphertext, storeId);
    const ghnProvince = (await ghnLocations(token, shopId)).find((item) => normalizeLocation(item.name) === normalizeLocation(province.name));
    const ghnWard = ghnProvince && (await ghnLocations(token, shopId, ghnProvince.id)).find((item) => normalizeLocation(item.name) === normalizeLocation(ward.name));
    if (!ghnProvince || !ghnWard) return unavailable("GHN chưa hỗ trợ địa chỉ đã chọn.");

    const result = await ghnShipmentRequest(token, shopId, "preview", {
      ...parcel, client_order_code: `GD-${randomUUID()}`,
      to_province_name: ghnProvince.name, to_ward_name: ghnWard.name,
      to_name: "Khách thử nghiệm", to_phone: "0900000000", to_address: "1 Đường Mẫu",
      is_new_to_address: true, service_type_id: 2, payment_type_id: 1,
      required_note: "KHONGCHOXEMHANG", cod_amount: 0, content: "Báo phí GrowDesk",
    });
    const { data, error } = await admin.from("ghn_checkout_quotes").insert({
      store_id: storeId, shop_id: shopId, items,
      address_hash: createHash("sha256").update(address).digest("hex"),
      fee_vnd: result.totalFee,
      snapshot: {
        provider: "ghn", environment: "staging", shop_id: shopId, service_type_id: 2,
        province: ghnProvince.name, ward: ghnWard.name, ...parcel, eta: result.expectedDelivery,
        packaging_id: profile.id, packaging_name: profile.name,
      },
    }).select("id,expires_at").single();
    if (error || !data) throw new Error("Quote could not be saved");
    await admin.from("ghn_checkout_quotes").delete().eq("store_id", storeId).lt("expires_at", new Date().toISOString());
    return Response.json({ id: data.id, address, fee: result.totalFee, expiresAt: data.expires_at });
  } catch {
    return unavailable("Chưa lấy được phí GHN. Vui lòng thử lại.", 503);
  }
}
