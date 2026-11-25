"use server";
import { revalidatePath } from "next/cache";
import { getMerchantContext } from "../data";
import { requireExpectedStore } from "@/lib/active-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptGhnToken, encryptGhnToken, verifyGhnShop } from "@/lib/shipping/ghn";
import { readDimensions } from "@/lib/shipping/packaging";

type Result = { ok:boolean; message:string };

export async function saveShippingAccountSelection(_previous: Result, form: FormData): Promise<Result> {
  const { store, membership, userId } = await getMerchantContext();
  if (!store || membership?.role !== "owner") return { ok: false, message: "Chỉ chủ cửa hàng được chọn tài khoản vận chuyển." };
  requireExpectedStore(form, store.id);

  const version = form.get("version_id");
  const revision = form.get("revision");
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  if (typeof version !== "string" || !uuid.test(version) || typeof revision !== "string" || (revision && !uuid.test(revision))) {
    return { ok: false, message: "Lựa chọn tài khoản không hợp lệ." };
  }

  try {
    const { data, error } = await createAdminClient().rpc("select_store_shipping_account", {
      target_store: store.id,
      actor: userId,
      target_version: version,
      expected_revision: revision || null,
    });
    if (!error) {
      revalidatePath("/dashboard/shipping");
      switch (data) {
        case "saved": return { ok: true, message: "Đã lưu lựa chọn tài khoản vận chuyển." };
        case "conflict": return { ok: false, message: "Cấu hình vừa thay đổi. Hãy xem lại tài khoản đang chọn." };
        case "unavailable": return { ok: false, message: "Tài khoản không còn khả dụng cho cửa hàng này." };
        case "forbidden": return { ok: false, message: "Bạn không có quyền thay đổi cấu hình của cửa hàng này." };
      }
    }
  } catch {
    // Return a user-facing error without exposing server or database details.
  }
  return { ok: false, message: "Chưa lưu được lựa chọn tài khoản vận chuyển." };
}

export async function saveGhnPackaging(_previous: Result, form: FormData): Promise<Result> {
  const store = await authorized(form);
  if (!store) return { ok: false, message: "Chỉ chủ cửa hàng được cấu hình đóng gói." };
  const id = String(form.get("packaging_id") ?? "");
  if (id && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
    return { ok: false, message: "Không tìm thấy bao bì." };
  }
  const removing = form.get("intent") === "delete";
  const name = String(form.get("name") ?? "").trim();
  const dimensions = readDimensions(form, true);
  const kind = form.get("kind");
  const packingRule = form.get("packing_rule");
  try {
    const packages = createAdminClient().from("store_ghn_packaging");
    if (removing) {
      if (!id) return { ok: false, message: "Không tìm thấy bao bì." };
      const { data, error } = await packages.delete().eq("id", id).eq("store_id", store.id).select("id").maybeSingle();
      if (error || !data) throw new Error("Packaging unavailable");
    } else {
      if (!name || name.length > 80 || !dimensions || (kind !== "box" && kind !== "bag") ||
        (packingRule !== "single" && packingRule !== "stack")) {
        return { ok: false, message: "Kiểm tra tên bao bì, bốn thông số và quy tắc đóng gói." };
      }
      const values = { name, kind, packing_rule: packingRule, ...dimensions };
      const result = id
        ? await packages.update(values).eq("id", id).eq("store_id", store.id).select("id").maybeSingle()
        : await packages.insert({ ...values, store_id: store.id }).select("id").single();
      if (result.error || !result.data) throw new Error("Packaging unavailable");
    }
    revalidatePath("/dashboard/shipping");
    revalidatePath(`/${store.slug}`);
    revalidatePath(`/store-host/${store.slug}`);
    return { ok: true, message: removing ? "Đã xóa bao bì." : "Đã lưu bao bì." };
  } catch {
    return { ok: false, message: removing ? "Chưa xóa được bao bì." : "Chưa lưu được bao bì." };
  }
}
async function authorized(form:FormData) {
  const ctx=await getMerchantContext();
  if(!ctx.store || ctx.membership?.role !== "owner") return null;
  requireExpectedStore(form,ctx.store.id);
  return ctx.store;
}
function failure(error:unknown):Result {
  const code=error instanceof Error ? error.message : "";
  if(code === "GHN_KEY_MISSING") return {ok:false,message:"Máy chủ chưa cấu hình khóa mã hóa GHN."};
  if(code === "GHN_SHOP_NOT_FOUND") return {ok:false,message:"Không tìm thấy cửa hàng GHN đang hoạt động với token này. Kiểm tra Shop ID và môi trường thử nghiệm."};
  if(code === "GHN_TOKEN_REJECTED") return {ok:false,message:"GHN từ chối token. Hãy kiểm tra token thuộc môi trường thử nghiệm và danh sách IP được phép của GHN."};
  if(code === "GHN_AUTH_OR_SHOP_REJECTED") return {ok:false,message:"GHN từ chối xác thực hoặc quyền truy cập cửa hàng. Hãy kiểm tra token thử nghiệm, Shop ID và quyền tài khoản GHN."};
  if(code === "GHN_SHOP_ACCESS_DENIED") return {ok:false,message:"Token được GHN chấp nhận nhưng tài khoản không truy cập được danh sách cửa hàng. Hãy kiểm tra quyền tài khoản với GHN."};
  if(code === "GHN_NETWORK_FAILED") return {ok:false,message:"Máy chủ không kết nối được GHN thử nghiệm. Hãy kiểm tra mạng và thử lại."};
  if(code === "GHN_REQUEST_FAILED" || code === "GHN_RESPONSE_INVALID") return {ok:false,message:"GHN chưa trả về danh sách cửa hàng hợp lệ. Hãy kiểm tra token thử nghiệm hoặc thử lại sau."};
  if(code === "GHN_SAVE_FAILED") return {ok:false,message:"Đã xác thực GHN nhưng chưa lưu được cấu hình. Hãy kiểm tra cơ sở dữ liệu thử nghiệm."};
  return {ok:false,message:"Không kết nối được GHN hoặc chưa lưu được cấu hình. Hãy kiểm tra token thử nghiệm, Shop ID và cấu hình máy chủ."};
}
export async function saveGhnConnection(form:FormData):Promise<Result> {
  const store=await authorized(form); if(!store) return {ok:false,message:"Chỉ chủ cửa hàng được kết nối GHN."};
  const token=String(form.get("token") || "").trim(), rawShop=String(form.get("shop_id") || "").trim();
  if (/^[•●.*…]+$/u.test(token)) return {ok:false,message:"Bạn đã nhập ký tự che token. Hãy hiện token bằng OTP rồi dùng nút sao chép trong GHN."};
  if(!token || token.length > 512 || /[\r\n]/.test(token) || !/^[1-9]\d{0,14}$/.test(rawShop) || !Number.isSafeInteger(Number(rawShop))) return {ok:false,message:"Vui lòng nhập token và Shop ID hợp lệ."};
  try {
    const ciphertext=encryptGhnToken(token,store.id);
    const shop=await verifyGhnShop(token,Number(rawShop));
    const {error}=await createAdminClient().from("store_ghn_connections").upsert({store_id:store.id,environment:"staging",shop_id:Number(rawShop),token_ciphertext:ciphertext,shop_name:shop.name,checked_at:new Date().toISOString(),updated_at:new Date().toISOString()});
    if(error) throw new Error("GHN_SAVE_FAILED");
    revalidatePath("/dashboard/shipping"); return {ok:true,message:"Đã kết nối GHN thử nghiệm."};
  } catch(error) { return failure(error); }
}
export async function checkGhnConnection(form:FormData):Promise<Result> {
  const store=await authorized(form); if(!store) return {ok:false,message:"Chỉ chủ cửa hàng được kiểm tra kết nối GHN."};
  try {
    const admin=createAdminClient(); const {data,error}=await admin.from("store_ghn_connections").select("shop_id,token_ciphertext").eq("store_id",store.id).maybeSingle();
    if(error || !data) return {ok:false,message:"Chưa có cấu hình GHN thử nghiệm."};
    const shop=await verifyGhnShop(decryptGhnToken(data.token_ciphertext,store.id),Number(data.shop_id));
    const {error:saveError}=await admin.from("store_ghn_connections").update({shop_name:shop.name,checked_at:new Date().toISOString()}).eq("store_id",store.id);
    if(saveError) throw saveError;
    revalidatePath("/dashboard/shipping"); return {ok:true,message:"Kết nối GHN thử nghiệm hoạt động."};
  } catch(error) { return failure(error); }
}
export async function disconnectGhn(form:FormData):Promise<Result> {
  const store=await authorized(form); if(!store) return {ok:false,message:"Chỉ chủ cửa hàng được ngắt kết nối GHN."};
  try { const {error}=await createAdminClient().from("store_ghn_connections").delete().eq("store_id",store.id); if(error) throw error; revalidatePath("/dashboard/shipping"); return {ok:true,message:"Đã ngắt kết nối GHN thử nghiệm."}; } catch(error) { return failure(error); }
}
