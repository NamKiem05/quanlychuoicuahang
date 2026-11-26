"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readThemeManifest, themeIdPattern } from "@/lib/theme-studio";
import { getMerchantContext } from "../data";

function back(message: string): never { redirect(`/dashboard/themes?message=${message}`); }

export async function autosaveStoreTheme(shop: string, theme: string, revision: number, value: unknown) {
  const config = readThemeManifest(value);
  if (!config || !themeIdPattern.test(theme) || !Number.isSafeInteger(revision) || revision < 0) return { error: "invalid" };
  const { supabase, store, membership } = await getMerchantContext();
  if (store?.id !== shop || membership?.role !== "owner") return { error: "conflict" };
  const { error } = await supabase.rpc("save_store_theme", { shop, theme, expected_revision: revision, config, operation: "draft" });
  if (error) return { error: error.code === "40001" ? "conflict" : "unavailable" };
  return { revision: revision + 1 };
}

export async function manageStoreTheme(form: FormData) {
  const { supabase, store, membership } = await getMerchantContext();
  if (!store || membership?.role !== "owner") redirect("/dashboard");
  const shop = store.id;
  const theme = String(form.get("theme") ?? "");
  if (!themeIdPattern.test(theme) || form.get("store") !== shop) back("invalid");
  const operation = form.get("operation");
  if (operation === "claim") {
    const release = String(form.get("release") ?? "");
    if (!themeIdPattern.test(release)) back("invalid");
    const { data, error } = await supabase.rpc("claim_store_theme", { shop, theme, release });
    if (error) back("failed");
    revalidatePath("/dashboard/themes");
    back(data ? "pending" : "claimed");
  }
  if (operation === "activate") {
    const { error } = await supabase.rpc("activate_store_theme", { shop, theme });
    if (error) back("failed");
  } else if (operation === "version") {
    const release = String(form.get("release") ?? "");
    const expected_revision = Number(form.get("revision"));
    if (!themeIdPattern.test(release) || !Number.isSafeInteger(expected_revision) || expected_revision < 0) back("invalid");
    const { data, error } = await supabase.rpc("apply_store_theme_release", { shop, theme, release, expected_revision });
    if (error) back(error.code === "40001" ? "conflict" : "failed");
    if (data?.status === "conflict") back("conflict");
    if (data?.status === "incompatible") back("incompatible_version");
    if (data?.status !== "success") back("failed");
  } else {
    const expected_revision = Number(form.get("revision"));
    if ((operation !== "draft" && operation !== "publish" && operation !== "reset" && operation !== "deactivate") || !Number.isSafeInteger(expected_revision)
      || expected_revision < 0 || ((operation === "reset" || operation === "deactivate") && form.get("confirm") !== "yes")) back("invalid");
    let config = null;
    if (operation === "draft") {
      try { config = readThemeManifest(JSON.parse(String(form.get("manifest") ?? ""))); } catch { back("invalid"); }
      if (!config) back("invalid");
    }
    const { error } = await supabase.rpc("save_store_theme", { shop, theme, expected_revision, config, operation });
    if (error) back(error.code === "40001" ? "conflict" : "failed");
  }
  revalidatePath("/dashboard/themes");
  revalidatePath(`/${store.slug}`);
  revalidatePath(`/store-host/${store.slug}`);
  back(operation === "draft" ? "saved" : "updated");
}
