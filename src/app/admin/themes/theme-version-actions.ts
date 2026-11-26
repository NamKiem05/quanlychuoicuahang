"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { createClient } from "@/lib/supabase/server";
import { themeIdPattern } from "@/lib/theme-studio";
import { semanticThemeVersion } from "@/lib/theme-version-management";

export async function manageThemeVersion(_: string, form: FormData) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const theme = text("theme");
  const revision = text("revision");
  const operation = text("operation");
  const release = text("release");
  if (!themeIdPattern.test(theme) || !/^\d{1,10}$/.test(revision)
    || Number(revision) > 2147483647 || text("confirm") !== "yes") return "Yêu cầu chưa hợp lệ.";
  const expected_revision = Number(revision);
  const query = new URLSearchParams({ theme });
  if (operation === "restore" && themeIdPattern.test(release)) {
    const { error } = await supabase.rpc("admin_restore_theme_version", { theme, release, expected_revision });
    if (error) return error.code === "40001" ? "Bản nháp vừa thay đổi. Hãy làm mới và xem lại trước khi khôi phục." : "Chưa khôi phục được snapshot.";
    query.set("message", "restored");
    query.set("preview", release);
  } else if (operation === "publish") {
    const version = text("version"), title = text("title"), notes = text("notes"), compatibility = text("compatibility"), kind = text("kind");
    if (!semanticThemeVersion.test(version) || !title || title.length > 100 || notes.length > 4000
      || compatibility.length > 2000 || !["major", "minor", "patch"].includes(kind)) return "Kiểm tra số phiên bản, tên và ghi chú phát hành.";
    const { data, error } = await supabase.rpc("admin_release_theme", {
      theme, expected_revision, release_version: version, release_title: title, notes, kind, compatibility,
    });
    if (error || typeof data !== "string") {
      if (error?.code === "40001") return "Bản nháp vừa thay đổi. Hãy làm mới và kiểm tra nội dung trước khi phát hành.";
      if (error?.code === "23505" || error?.code === "PT422") return "Số phiên bản phải lớn hơn bản gần nhất và khớp loại thay đổi.";
      if (error?.code === "PT423") return "Bản nháp tham chiếu ảnh đã thiếu trong Storage.";
      if (error?.code === "22023" || error?.code === "23514") return "Bản nháp vi phạm schema hoặc chính sách trang và ngành hàng.";
      return "Chưa phát hành được phiên bản.";
    }
    query.set("message", "published");
    query.set("preview", data);
  } else return "Thao tác phiên bản không hợp lệ.";
  revalidatePath("/admin/themes", "layout");
  revalidatePath("/dashboard/themes");
  redirect(`/admin/themes/versions?${query}`);
}
