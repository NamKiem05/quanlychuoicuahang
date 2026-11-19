import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptGhnToken, ghnLocations, ghnShipmentRequest } from "@/lib/shipping/ghn";
import { dimensionFields, packItems, type Dimensions, type Packaging } from "@/lib/shipping/packaging";
import provinces from "@/lib/vietnam-checkout-addresses.json";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const normalizeLocation = (name: string) => name.trim().toLocaleLowerCase("vi").replace(/^(tỉnh|thành phố|phường|xã|đặc khu)\s+/u, "");

export async function POST(request: Request) {
  const unavailable = (message: string, status = 422) => Response.json({ message }, { status });
  const input = await request.json().catch(() => null);
  if (!input || typeof input.slug !== "string" || !/^[a-z0-9-]{1,80}$/.test(input.slug) ||
    typeof input.detail !== "string" || input.detail.trim().length < 1 || input.detail.length > 400 ||
    !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 30) {
    return unavailable("Thông tin báo phí GHN chưa hợp lệ.", 400);
  }
  const items = input.items as { product_id: string; quantity: number; option_ids?: string[]; variant_id?: string }[];
  if (!items.every((item) => item && typeof item.product_id === "string" && uuid.test(item.product_id) &&
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
    const admin = createAdminClient();
    const store = await admin.from("stores").select("id").eq("slug", input.slug)
      .eq("status", "active").eq("accepts_orders", true).eq("delivery_enabled", true).maybeSingle();
    if (store.error || !store.data) return unavailable("Cửa hàng chưa nhận đơn giao tận nơi.", 404);
    const storeId = store.data.id;
    const [connection, packaging, products] = await Promise.all([
      admin.from("store_ghn_connections").select("shop_id,token_ciphertext").eq("store_id", storeId).eq("environment", "staging").maybeSingle(),
      admin.from("store_ghn_packaging").select("kind,packing_rule,weight_g,length_cm,width_cm,height_cm").eq("store_id", storeId).maybeSingle(),
      admin.from("products").select("id,shipping_dimensions").eq("store_id", storeId).eq("status", "active")
        .in("id", [...new Set(items.map((item) => item.product_id))]),
    ]);
    if (connection.error || packaging.error || products.error || !connection.data || !packaging.data) {
      return unavailable("Cửa hàng chưa sẵn sàng báo phí GHN.", 503);
    }

    const dimensionsByProduct = new Map(products.data.map((item) => [item.id, item.shipping_dimensions as Dimensions | null]));
    const parcelItems = [];
    for (const item of items) {
      const dimensions = dimensionsByProduct.get(item.product_id);
      if (!dimensions || dimensionFields.some(([key, , max]) => !Number.isInteger(dimensions[key]) || dimensions[key] < 1 || dimensions[key] > max)) {
        return unavailable("Có sản phẩm chưa được cửa hàng khai báo thông số vận chuyển.");
      }
      parcelItems.push({ dimensions, quantity: item.quantity });
    }
    const parcel = packItems(packaging.data as Packaging, parcelItems);
    if (!parcel) return unavailable("Giỏ hàng không vừa một kiện GHN theo quy cách của cửa hàng.");

    const shopId = Number(connection.data.shop_id);
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
    if (!Number.isSafeInteger(result.totalFee)) throw new Error("Invalid GHN fee");
    const { data, error } = await admin.from("ghn_checkout_quotes").insert({
      store_id: storeId, shop_id: shopId, items,
      address_hash: createHash("sha256").update(address).digest("hex"),
      fee_vnd: result.totalFee,
      snapshot: {
        provider: "ghn", environment: "staging", shop_id: shopId, service_type_id: 2,
        province: ghnProvince.name, ward: ghnWard.name, ...parcel, eta: result.expectedDelivery,
      },
    }).select("id,expires_at").single();
    if (error || !data) throw new Error("Quote could not be saved");
    await admin.from("ghn_checkout_quotes").delete().eq("store_id", storeId).lt("expires_at", new Date().toISOString());
    return Response.json({ id: data.id, address, fee: result.totalFee, expiresAt: data.expires_at });
  } catch {
    return unavailable("Chưa lấy được phí GHN. Vui lòng thử lại.", 503);
  }
}
