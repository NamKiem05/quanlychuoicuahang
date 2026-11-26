"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { createClient } from "@/lib/supabase/server";
import { componentStatuses, themeBlocks } from "@/lib/theme-pages";

export async function updateComponentStatus(_: string, form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const key = String(form.get("component") ?? "");
  const next = String(form.get("state") ?? "");
  const expected = String(form.get("expected") ?? "");
  if (!Object.hasOwn(themeBlocks, key) || !Object.hasOwn(componentStatuses, next)
    || !Object.hasOwn(componentStatuses, expected) || form.get("confirm") !== "yes") return "Trạng thái hoặc mã component không hợp lệ.";
  const { error } = await supabase.rpc("admin_set_theme_component_status", { component: key, next_state: next, expected_state: expected });
  if (error) return error.code === "40001" ? "Trạng thái vừa thay đổi. Hãy làm mới trước khi tiếp tục." : "Chưa cập nhật được trạng thái.";
  revalidatePath("/admin/themes", "layout");
  revalidatePath("/dashboard/themes");
  redirect(`/admin/themes/components?preview=${key}&message=saved`);
}
