"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { encryptShippingToken } from "@/lib/shipping/account-credentials";
import { verifyShippingAccount } from "./check-account";
import { accountMetadata, checkErrors, environments, type ActionResult } from "./model";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const providerCode = /^[a-z][a-z0-9_-]{1,39}$/;
const fail = (message: string): ActionResult => ({ ok: false, message });
const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function done(message: string): ActionResult {
  revalidatePath("/admin/shipping", "layout");
  return { ok: true, message };
}

async function authorize() {
  return requirePlatformAdminAccess(await createClient());
}

export async function saveProvider(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  await authorize();
  const code = field(form, "code").toLowerCase();
  const name = field(form, "name");
  const logo = field(form, "logo_url");
  const mode = field(form, "mode");
  if (!providerCode.test(code) || !name || name.length > 120 || logo.length > 500 ||
      (mode !== "create" && mode !== "edit")) return fail("Thông tin nhà cung cấp chưa hợp lệ.");
  if (logo) {
    try {
      const url = new URL(logo);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    } catch {
      return fail("Dùng địa chỉ HTTPS hợp lệ cho logo.");
    }
  }

  try {
    const table = createAdminClient().from("shipping_providers");
    const values = { name, logo_url: logo || null };
    const result = mode === "create"
      ? await table.insert({ code, ...values }).select("code").single()
      : await table.update(values).eq("code", code).select("code").maybeSingle();
    if (result.error?.code === "23505") return fail("Mã nhà cung cấp đã tồn tại.");
    if (result.error || !result.data) return fail("Chưa lưu được nhà cung cấp.");
    return done("Đã lưu nhà cung cấp.");
  } catch {
    return fail("Chưa lưu được nhà cung cấp.");
  }
}

export async function toggleProvider(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  await authorize();
  const code = field(form, "code");
  const enabled = field(form, "enabled");
  if (!providerCode.test(code) || !["true", "false"].includes(enabled)) return fail("Yêu cầu chưa hợp lệ.");
  try {
    const { data, error } = await createAdminClient().from("shipping_providers")
      .update({ catalog_enabled: enabled === "true" }).eq("code", code).select("code").maybeSingle();
    if (error || !data) return fail("Chưa đổi được trạng thái danh mục.");
    return done("Đã cập nhật trạng thái danh mục.");
  } catch {
    return fail("Chưa đổi được trạng thái danh mục.");
  }
}

export async function saveAccount(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  await authorize();
  const requestedId = field(form, "id");
  const name = field(form, "name");
  const shopId = field(form, "external_shop_id");
  const token = field(form, "token");
  if ((requestedId && !uuid.test(requestedId)) || !name || name.length > 120 ||
      !/^[A-Za-z0-9_.-]{1,80}$/.test(shopId) || (token && !/^[\x21-\x7e]{1,512}$/.test(token))) {
    return fail("Thông tin tài khoản chưa hợp lệ.");
  }

  try {
    const table = createAdminClient().from("shipping_provider_accounts");
    const existing = requestedId
      ? await table.select("provider_code,environment,config_revision")
        .eq("id", requestedId).eq("scope", "platform").maybeSingle()
      : { data: null, error: null };
    if (existing.error || (requestedId && !existing.data)) return fail("Không tìm thấy tài khoản GrowDesk.");
    const code = existing.data?.provider_code ?? field(form, "provider_code");
    const environment = existing.data?.environment ?? field(form, "environment");
    if (!providerCode.test(code) || !Object.hasOwn(environments, environment)) {
      return fail("Nhà cung cấp hoặc môi trường chưa hợp lệ.");
    }
    if (code === "ghn" && environment !== "simulation" && !/^[1-9]\d{0,9}$/.test(shopId)) {
      return fail("Shop ID GHN phải là số nguyên dương, tối đa 10 chữ số.");
    }
    if (token && (code !== "ghn" || environment !== "sandbox")) {
      return fail("Giai đoạn này chỉ nhận token cho GHN Staging.");
    }

    const id = requestedId || randomUUID();
    const identity = { id, provider_code: code, environment, scope: "platform", store_id: null };
    const values = {
      name, external_shop_id: shopId,
      ...(token ? { credential_ciphertext: encryptShippingToken(token, identity) } : {}),
    };
    const result = existing.data
      ? await table.update(values).eq("id", id).eq("scope", "platform")
        .eq("config_revision", existing.data.config_revision).select("id").maybeSingle()
      : await table.insert({ ...identity, ...values }).select("id").single();
    if (result.error?.code === "23505") return fail("Tài khoản với Shop ID và môi trường này đã tồn tại.");
    if (result.error || !result.data) return fail("Chưa lưu được tài khoản. Hãy kiểm tra cấu hình và tải lại trang.");
    return done("Đã lưu tài khoản GrowDesk.");
  } catch (error) {
    return fail(error instanceof Error && error.message === "KEY_UNAVAILABLE"
      ? checkErrors.KEY_UNAVAILABLE : "Chưa lưu được tài khoản.");
  }
}

export async function toggleAccount(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  await authorize();
  const id = field(form, "id");
  const enabled = field(form, "enabled");
  if (!uuid.test(id) || !["true", "false"].includes(enabled)) return fail("Yêu cầu chưa hợp lệ.");

  try {
    const admin = createAdminClient();
    const table = admin.from("shipping_provider_accounts");
    let update = table.update({ enabled: enabled === "true" }).eq("id", id).eq("scope", "platform");
    if (enabled === "true") {
      update = update.eq("provider_code", "ghn").eq("environment", "sandbox").eq("connection_status", "verified");
    }
    const { data, error } = await update.select("id").maybeSingle();
    if (error?.code === "23514" && error.message === "shipping_account_provider_catalog_enabled") {
      return fail(checkErrors.PROVIDER_DISABLED);
    }
    if (error || !data) return fail("Chưa đổi được trạng thái. Tài khoản bật phải là GHN Staging đã xác minh.");
    return done("Đã cập nhật trạng thái tài khoản.");
  } catch {
    return fail("Chưa đổi được trạng thái tài khoản.");
  }
}

export async function checkAccount(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const actor = await authorize();
  const id = field(form, "id");
  if (!uuid.test(id)) return fail("Mã tài khoản chưa hợp lệ.");

  try {
    const admin = createAdminClient();
    const claim = await admin.rpc("begin_shipping_account_check", { target_id: id, actor });
    if (claim.error || !claim.data) return fail("Chưa bắt đầu được kiểm tra tài khoản GrowDesk.");
    if (claim.data.state === "missing") return fail("Không tìm thấy tài khoản GrowDesk.");
    if (claim.data.state === "busy") return fail("Đang có lần kiểm tra khác hoặc vừa kiểm tra. Hãy thử lại sau.");
    if (claim.data.state !== "claimed") return fail("Máy chủ trả về trạng thái kiểm tra không hợp lệ.");
    const { id: checkId, revision } = claim.data;
    const result = await (async () => {
      const [account, provider] = await Promise.all([
        admin.from("shipping_provider_accounts").select(`${accountMetadata},credential_ciphertext`)
          .eq("id", id).eq("scope", "platform").eq("config_revision", revision).maybeSingle(),
        admin.from("shipping_providers").select("catalog_enabled").eq("code", "ghn").maybeSingle(),
      ]);
      return account.error || !account.data || provider.error
        ? { status: "failed", error: "PROVIDER_UNAVAILABLE" }
        : verifyShippingAccount(account.data, provider.data?.catalog_enabled === true);
    })().catch(() => ({ status: "failed", error: "PROVIDER_UNAVAILABLE" }));
    const saved = await admin.rpc("finish_shipping_account_check", {
      target_id: id, check_id: checkId, check_result: result.status, failure_code: result.error,
    });
    if (saved.error) return fail("Chưa lưu được kết quả kiểm tra.");
    revalidatePath("/admin/shipping", "layout");
    switch (saved.data) {
      case "superseded": return fail(checkErrors.CONFIG_CHANGED);
      case "expired": return fail(checkErrors.CHECK_EXPIRED);
      case "provider_disabled": return fail(checkErrors.PROVIDER_DISABLED);
      case "already_finished": return fail("Lần kiểm tra này đã hoàn tất. Hãy xem lịch sử.");
      case "missing": return fail("Không tìm thấy lần kiểm tra hoặc tài khoản GrowDesk.");
      case "verified": return { ok: true, message: "Đã xác minh kết nối GHN Staging." };
      case "failed":
      case "not_configured": return fail(checkErrors[result.error ?? "PROVIDER_UNAVAILABLE"]);
      default: return fail("Máy chủ trả về trạng thái kiểm tra không hợp lệ.");
    }
  } catch {
    return fail("Chưa hoàn tất kiểm tra kết nối.");
  }
}
